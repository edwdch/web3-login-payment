<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { createWalletClient, custom, type WalletClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { SiweMessage } from 'siwe'
import axios, { type AxiosResponse } from 'axios'
import { withPaymentInterceptor } from 'x402-axios'
import AccessKeyManager from '@/components/AccessKeyManager.vue'

// Ethereum provider type
interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

interface User {
  publicAddress: string
  id?: string | number
}

const user = ref<User | null>(null)
const loading = ref(false)
const error = ref('')

// Plan config
type Plan = 'free' | 'base' | 'pay-as-you-go'
type PaymentPeriod = 'monthly' | 'quarterly' | 'yearly'
type DataType = 'price' | 'sports' | 'weather' | 'politics'

interface PlanOption {
  key: Plan
  label: string
  description: string
}

interface PeriodOption {
  key: PaymentPeriod
  label: string
  price: string
  days: number
  discount?: string
}

interface DataTypeOption {
  key: DataType
  label: string
}

const planOptions: PlanOption[] = [
  { key: 'free', label: 'Free', description: '14 days trial' },
  { key: 'base', label: 'Base', description: 'Full access' },
  { key: 'pay-as-you-go', label: 'Pay As You Go', description: 'Flexible' },
]

const periodOptions: PeriodOption[] = [
  { key: 'monthly', label: 'Monthly', price: '20.00', days: 30 },
  { key: 'quarterly', label: 'Quarterly', price: '54.00', days: 90, discount: '10% off' },
  { key: 'yearly', label: 'Yearly', price: '200.00', days: 365, discount: '17% off' },
]

const dataTypeOptions: DataTypeOption[] = [
  { key: 'price', label: 'Price' },
  { key: 'sports', label: 'Sports' },
  { key: 'weather', label: 'Weather' },
  { key: 'politics', label: 'Politics' },
]

const selectedPlan = ref<Plan>('free')
const selectedPeriod = ref<PaymentPeriod>('monthly')
const selectedDataType = ref<DataType>('price')
const payAsYouGoAmount = ref<string>('10')

// API instance
const api = axios.create({
  baseURL: '/api', // Modify according to actual backend address
  withCredentials: true
})

// Initialize x402-axios
let walletClient: WalletClient | null = null
let interceptorInstalled = false

function setupWallet(address: string) {
  if (typeof window === 'undefined' || !window.ethereum) return

  walletClient = createWalletClient({
    account: address as `0x${string}`,
    chain: baseSepolia,
    transport: custom(window.ethereum)
  })

  if (!interceptorInstalled) {
    // 添加支付拦截器
    // @ts-expect-error: x402-axios types might mismatch slightly with viem version or strictness
    withPaymentInterceptor(api, walletClient)
    interceptorInstalled = true
  }
}

// 辅助函数：安全获取数据
function getResponseData(response: AxiosResponse) {
  return response.data?.data || response.data
}

// ==========================================
// 4. 身份验证逻辑 (Auth Logic / SIWE)
// ==========================================

async function checkSession() {
  try {
    const res = await api.get('/user/me')
    user.value = getResponseData(res).user

    // If user is logged in, try to silently restore wallet connection
    if (user.value && window.ethereum) {
      const tempClient = createWalletClient({
        transport: custom(window.ethereum)
      })
      // Try to get currently connected account (no popup)
      // Note: viem's requestAddresses calls eth_requestAccounts, will popup if not authorized
      // Here we assume user authorized before, or we only force connect when clicking pay
      // For better UX, try to get account, if successful then setupWallet
      try {
         const [address] = await tempClient.requestAddresses()
         if (address) {
           setupWallet(address)
         }
      } catch (e) {
        console.log('Silent wallet connect failed', e)
      }
    }
  } catch {
    user.value = null
  }
}

async function connectAndLogin() {
  error.value = ''
  loading.value = true
  try {
    if (!window.ethereum) throw new Error('Please install MetaMask.')

    // 1. Get address (using temporary client)
    const tempClient = createWalletClient({
      chain: baseSepolia,
      transport: custom(window.ethereum)
    })
    const [address] = await tempClient.requestAddresses()
    if (!address) throw new Error('No account found')

    // 2. Initialize official walletClient (with account) and install interceptor
    setupWallet(address)

    if (!walletClient) throw new Error('Wallet initialization failed')

    const chainId = await walletClient.getChainId()

    // 3. Get Nonce
    const nonceRes = await api.get('/user/nonce', { params: { address } })
    const nonce = getResponseData(nonceRes)

    // 4. Create SIWE Message
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in to Access Resources',
      uri: window.location.origin,
      version: '1',
      chainId: chainId,
      nonce,
    })

    const preparedMessage = message.prepareMessage()
    // 使用 viem 签名
    const signature = await walletClient.signMessage({
      account: address,
      message: preparedMessage
    })

    // 5. Verify
    const verifyRes = await api.post('/user/verify', { message: preparedMessage, signature })
    user.value = getResponseData(verifyRes).user

  } catch (err: unknown) {
    console.error(err)
    const axiosErr = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = axiosErr.response?.data?.error || axiosErr.message || 'Login failed'
  } finally {
    loading.value = false
  }
}

async function logout() {
  try {
    await api.post('/user/logout')
    user.value = null
  } catch (err) { console.error(err) }
}

// ==========================================
// 5. 业务核心：处理支付 (Payment Flow)
// ==========================================

async function handlePayment() {
  loading.value = true
  error.value = ''

  try {
    // 直接请求资源，x402-axios 会自动处理 402 错误并进行支付
    let res: AxiosResponse

    if (selectedPlan.value === 'free') {
      // Free plan: GET with dataType query param
      res = await api.get('/payment/free', { params: { dataType: selectedDataType.value } })
    } else if (selectedPlan.value === 'pay-as-you-go') {
      // Pay-as-you-go: POST with amount and dataType in body
      const amount = parseFloat(payAsYouGoAmount.value)
      if (isNaN(amount) || amount < 10) {
        error.value = 'Minimum amount is $10'
        loading.value = false
        return
      }
      res = await api.post('/payment/pay-as-you-go/x402', {
        amount: amount.toFixed(2),
        dataType: selectedDataType.value,
      })
    } else {
      // Subscription plan: GET with dataType, plan, period
      res = await api.get(`/payment/${selectedDataType.value}/${selectedPlan.value}/${selectedPeriod.value}`)
    }

    handleSuccess(res)
  } catch (err: unknown) {
    console.error('Payment failed or request error:', err)
    // User rejected or transaction failed
    const paymentErr = err as { code?: string; cause?: { code?: number }; response?: { data?: { error?: string } }; message?: string }
    if (paymentErr.code === 'ACTION_REJECTED' || paymentErr.cause?.code === 4001) {
      error.value = 'You rejected the transaction.'
    } else {
      error.value = paymentErr.response?.data?.error || paymentErr.message || 'Request failed'
    }
  } finally {
    loading.value = false
  }
}

function handleSuccess(res: AxiosResponse) {
  const data = getResponseData(res)
  if (data && data.url) {
    // If it's a resource link, redirect
    window.location.href = data.url
  } else {
    alert('Payment validated successfully! Resource is now accessible.')
  }
}

onMounted(() => {
  checkSession()
})
</script>

<template>
  <main>
    <div class="container">
      <div v-if="loading" class="card loading-card">
        <div class="status-box loading">
          <div class="spinner"></div>
          <p>Processing transaction...</p>
        </div>
      </div>

      <div v-else-if="user" class="layout-wrapper">
        <!-- Left Panel: Payment -->
        <div class="card left-panel">
          <h1>x402 Payment Demo</h1>
          <p class="subtitle">Decentralized Resource Access</p>

          <div class="content-box">
            <div class="user-badge">
              <span class="label">Connected:</span>
              <span class="address">
                {{ user.publicAddress?.slice(0,6) }}...{{ user.publicAddress?.slice(-4) }}</span>
            </div>

            <div class="actions">
              <p>Select your plan</p>

              <!-- Plan Selector -->
              <div class="plan-selector">
                <button
                  v-for="option in planOptions"
                  :key="option.key"
                  @click="selectedPlan = option.key"
                  :class="['plan-btn', { active: selectedPlan === option.key }]"
                >
                  <span class="plan-label">{{ option.label }}</span>
                  <span class="plan-desc">{{ option.description }}</span>
                </button>
              </div>

              <!-- Data Type Selector -->
              <p class="section-title">Select data type</p>
              <div class="data-type-selector">
                <button
                  v-for="option in dataTypeOptions"
                  :key="option.key"
                  @click="selectedDataType = option.key"
                  :class="['data-type-btn', { active: selectedDataType === option.key }]"
                >
                  {{ option.label }}
                </button>
              </div>

              <!-- Period Selector (only for base plan) -->
              <template v-if="selectedPlan === 'base'">
                <p class="period-title">Select subscription period and pay with <strong>USDC (Base Sepolia)</strong></p>
                <div class="period-selector">
                  <button
                    v-for="option in periodOptions"
                    :key="option.key"
                    @click="selectedPeriod = option.key"
                    :class="['period-btn', { active: selectedPeriod === option.key }]"
                  >
                    <span class="period-label">{{ option.label }}</span>
                    <span class="period-price">${{ option.price }}</span>
                    <span v-if="option.discount" class="period-discount">{{ option.discount }}</span>
                  </button>
                </div>
              </template>

              <!-- Pay-as-you-go Amount Input -->
              <template v-if="selectedPlan === 'pay-as-you-go'">
                <p class="period-title">Enter amount (min $10) and pay with <strong>USDC (Base Sepolia)</strong></p>
                <div class="amount-input-wrapper">
                  <span class="currency-symbol">$</span>
                  <input
                    v-model="payAsYouGoAmount"
                    type="number"
                    min="10"
                    step="0.01"
                    placeholder="10.00"
                    class="amount-input"
                  />
                </div>
                <p class="amount-hint">Valid for 1 year from payment</p>
              </template>

              <button @click="handlePayment" class="btn primary-btn">
                {{ selectedPlan === 'free' ? 'Start Free Trial' : selectedPlan === 'pay-as-you-go' ? `Pay $${payAsYouGoAmount}` : 'Pay & Access Resource' }}
              </button>

              <button @click="logout" class="btn text-btn">Disconnect</button>
            </div>

            <div v-if="error" class="error-msg">
              ⚠️ {{ error }}
            </div>
          </div>
        </div>

        <!-- Right Panel: Access Key Manager -->
        <div class="card right-panel">
          <AccessKeyManager />
        </div>
      </div>

      <div v-else class="card login-card">
        <h1>x402 Payment Demo</h1>
        <p class="subtitle">Decentralized Resource Access</p>
        <div class="login-box">
          <p>Connect your wallet to continue</p>
          <button @click="connectAndLogin" class="btn primary-btn">
            Connect Wallet
          </button>
        </div>
        <div v-if="error" class="error-msg">
          ⚠️ {{ error }}
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* Base reset and layout */
main {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100vh;
  width: 100vw;
  margin: 0;
  padding: 2rem;
  box-sizing: border-box;
  background: #f0f2f5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow-y: auto;
}

.container {
  width: 100%;
  max-width: 1200px;
}

/* Layout wrapper for left-right panels */
.layout-wrapper {
  display: grid;
  grid-template-columns: 400px 1fr;
  gap: 1.5rem;
  align-items: start;
}

/* Card styles */
.card {
  background: white;
  padding: 2rem;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}

.left-panel {
  text-align: center;
  position: sticky;
  top: 2rem;
}

.right-panel {
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.right-panel :deep(.access-key-manager) {
  margin-top: 0;
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}

.loading-card,
.login-card {
  max-width: 500px;
  margin: 0 auto;
  text-align: center;
}

h1 { margin: 0 0 0.5rem; color: #1a1a1a; font-size: 1.5rem; }
.subtitle { margin: 0 0 2rem; color: #666; font-size: 0.9rem; }

/* Button common styles */
.btn { display: inline-block; padding: 0.8rem 1.5rem; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 1rem; width: 100%; margin-bottom: 0.5rem; }
.primary-btn { background: #0052ff; color: white; } /* Base Brand Color */
.primary-btn:hover { background: #0040d1; }
.text-btn { background: transparent; color: #666; margin-top: 0.5rem; }
.text-btn:hover { color: #333; background: #f5f5f5; }

/* User info */
.user-badge { background: #f0f8ff; display: inline-block; padding: 0.5rem 1rem; border-radius: 20px; margin-bottom: 1.5rem; border: 1px solid #e0e0e0; }
.label { color: #666; margin-right: 5px; font-size: 0.9rem; }
.address { font-family: monospace; color: #333; font-weight: bold; }

/* Error message */
.error-msg { margin-top: 1.5rem; padding: 0.8rem; background: #fff2f0; border: 1px solid #ffccc7; border-radius: 8px; color: #cf1322; font-size: 0.9rem; text-align: left; }

/* Loading Spinner */
.loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem 0; }
.spinner { width: 30px; height: 30px; border: 3px solid #f3f3f3; border-top: 3px solid #0052ff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem; }

@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

/* Plan selector */
.plan-selector { display: flex; gap: 0.5rem; margin-bottom: 1rem; margin-top: 1rem; }
.plan-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 0.5rem;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
}
.plan-btn:hover { border-color: #0052ff; background: #f0f8ff; }
.plan-btn.active { border-color: #0052ff; background: #e6f0ff; }
.plan-label { font-size: 1rem; font-weight: 700; color: #1a1a1a; margin-bottom: 0.25rem; }
.plan-desc { font-size: 0.8rem; color: #666; }

/* Period selector */
.period-title { margin-top: 1.5rem; margin-bottom: 0; }
.period-selector { display: flex; gap: 0.5rem; margin-bottom: 1rem; margin-top: 1rem; }
.period-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.8rem 0.5rem;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}
.period-btn:hover { border-color: #0052ff; background: #f0f8ff; }
.period-btn.active { border-color: #0052ff; background: #e6f0ff; }
.period-label { font-size: 0.85rem; color: #666; margin-bottom: 0.25rem; }
.period-price { font-size: 1.1rem; font-weight: 700; color: #1a1a1a; }
.period-discount {
  position: absolute;
  top: -8px;
  right: -8px;
  background: #ff4d4f;
  color: white;
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 600;
}

/* Data type selector */
.section-title { margin-top: 1rem; margin-bottom: 0; font-size: 0.9rem; }
.data-type-selector { display: flex; gap: 0.5rem; margin-bottom: 1rem; margin-top: 0.5rem; flex-wrap: wrap; }
.data-type-btn {
  flex: 1;
  min-width: 70px;
  padding: 0.5rem 0.8rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.85rem;
  font-weight: 500;
  color: #666;
}
.data-type-btn:hover { border-color: #0052ff; background: #f0f8ff; color: #0052ff; }
.data-type-btn.active { border-color: #0052ff; background: #e6f0ff; color: #0052ff; }

/* Amount input for pay-as-you-go */
.amount-input-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1rem 0;
  padding: 0.8rem 1rem;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  background: white;
  transition: border-color 0.2s;
}
.amount-input-wrapper:focus-within { border-color: #0052ff; }
.currency-symbol { font-size: 1.2rem; font-weight: 600; color: #666; }
.amount-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 1.2rem;
  font-weight: 600;
  color: #1a1a1a;
  background: transparent;
}
.amount-input::placeholder { color: #ccc; }
.amount-input::-webkit-outer-spin-button,
.amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.amount-input[type=number] { -moz-appearance: textfield; appearance: textfield; }
.amount-hint { font-size: 0.8rem; color: #666; margin: 0 0 1rem; }

/* Responsive: stack on smaller screens */
@media (max-width: 900px) {
  .layout-wrapper {
    grid-template-columns: 1fr;
  }

  .left-panel {
    position: static;
  }
}
</style>
