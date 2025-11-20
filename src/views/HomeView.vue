<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { createWalletClient, custom, type WalletClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { SiweMessage } from 'siwe'
import axios, { type AxiosResponse } from 'axios'
import { withPaymentInterceptor } from 'x402-axios'

const user = ref<any>(null)
const loading = ref(false)
const error = ref('')

// API 实例
const api = axios.create({
  baseURL: '/api', // 请根据实际后端地址修改
  withCredentials: true
})

// 初始化 x402-axios
let walletClient: WalletClient | null = null
let interceptorInstalled = false

function setupWallet(address: string) {
  if (typeof window === 'undefined' || !(window as any).ethereum) return

  walletClient = createWalletClient({
    account: address as `0x${string}`,
    chain: baseSepolia,
    transport: custom((window as any).ethereum)
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
    
    // 如果用户已登录，尝试静默恢复钱包连接
    if (user.value && (window as any).ethereum) {
      const tempClient = createWalletClient({
        transport: custom((window as any).ethereum)
      })
      // 尝试获取当前连接的账户（不弹窗）
      // 注意：viem 的 requestAddresses 会调用 eth_requestAccounts，如果未授权会弹窗
      // 这里我们假设用户之前授权过，或者我们只在点击支付时才强制连接
      // 为了更好的体验，我们可以尝试获取账户，如果获取到了就 setupWallet
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
    if (!(window as any).ethereum) throw new Error('Please install MetaMask.')

    // 1. 获取地址 (使用临时 client)
    const tempClient = createWalletClient({
      chain: baseSepolia,
      transport: custom((window as any).ethereum)
    })
    const [address] = await tempClient.requestAddresses()
    if (!address) throw new Error('No account found')

    // 2. 初始化正式的 walletClient (带 account) 并安装拦截器
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

  } catch (err: any) {
    console.error(err)
    error.value = err.response?.data?.error || err.message || 'Login failed'
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

async function handlePayment(plan: string) {
  loading.value = true
  error.value = ''

  try {
    // 直接请求资源，x402-axios 会自动处理 402 错误并进行支付
    const res = await api.get(`/payment/${plan}`)
    handleSuccess(res)

  } catch (err: any) {
    console.error('Payment failed or request error:', err)
    // 用户拒绝或交易失败
    if (err.code === 'ACTION_REJECTED' || err.cause?.code === 4001) {
      error.value = 'You rejected the transaction.'
    } else {
      error.value = err.response?.data?.error || err.message || 'Request failed'
    }
  } finally {
    loading.value = false
  }
}

function handleSuccess(res: any) {
  const data = getResponseData(res)
  if (data && data.url) {
    // 如果是资源链接，跳转
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
      <div class="card">
        <h1>x402 Payment Demo</h1>
        <p class="subtitle">Decentralized Resource Access</p>

        <div v-if="loading" class="status-box loading">
          <div class="spinner"></div>
          <p>Processing transaction...</p>
        </div>

        <div v-else-if="user" class="content-box">
          <div class="user-badge">
            <span class="label">Connected:</span>
            <span class="address">{{ user.publicAddress?.slice(0,6) }}...{{ user.publicAddress?.slice(-4) }}</span>
          </div>

          <div class="actions">
            <p>Unlock premium content for <strong>USDC (Base Sepolia)</strong></p>

            <button @click="handlePayment('basic')" class="btn primary-btn">
              Pay & Access Resource
            </button>

            <button @click="logout" class="btn text-btn">Disconnect</button>
          </div>
        </div>

        <div v-else class="login-box">
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
/* 基础重置与布局 */
main { display: flex; justify-content: center; align-items: center; min-height: 100vh; width: 100%; background: #f0f2f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.container { width: 100%; max-width: 480px; padding: 20px; }

/* 卡片样式 */
.card { background: white; padding: 2rem; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: center; }
h1 { margin: 0 0 0.5rem; color: #1a1a1a; font-size: 1.5rem; }
.subtitle { margin: 0 0 2rem; color: #666; font-size: 0.9rem; }

/* 按钮通用 */
.btn { display: inline-block; padding: 0.8rem 1.5rem; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 1rem; width: 100%; margin-bottom: 0.5rem; }
.primary-btn { background: #0052ff; color: white; } /* Base Brand Color */
.primary-btn:hover { background: #0040d1; }
.text-btn { background: transparent; color: #666; margin-top: 0.5rem; }
.text-btn:hover { color: #333; background: #f5f5f5; }

/* 用户信息 */
.user-badge { background: #f0f8ff; display: inline-block; padding: 0.5rem 1rem; border-radius: 20px; margin-bottom: 1.5rem; border: 1px solid #e0e0e0; }
.label { color: #666; margin-right: 5px; font-size: 0.9rem; }
.address { font-family: monospace; color: #333; font-weight: bold; }

/* 错误提示 */
.error-msg { margin-top: 1.5rem; padding: 0.8rem; background: #fff2f0; border: 1px solid #ffccc7; border-radius: 8px; color: #cf1322; font-size: 0.9rem; text-align: left; }

/* Loading Spinner */
.loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem 0; }
.spinner { width: 30px; height: 30px; border: 3px solid #f3f3f3; border-top: 3px solid #0052ff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem; }

@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
</style>
