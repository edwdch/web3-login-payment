<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { BrowserProvider, Contract } from 'ethers'
import { SiweMessage } from 'siwe'
import axios, { type AxiosResponse } from 'axios'

// ==========================================
// 1. 类型定义 (Type Definitions)
// ==========================================

// x402 协议返回的支付选项结构
interface X402Option {
  scheme: string
  network: string     // e.g., "base-sepolia", "ethereum"
  resource: string
  payTo: string
  asset: string       // ERC20 Token Address
  maxAmountRequired: string // Wei format
  extra?: {
    name?: string
    decimals?: number
  }
}

// 前端维护的网络配置结构
interface ChainConfig {
  chainIdHex: string
  chainIdDec: number
  chainName: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  rpcUrls: string[]
  blockExplorerUrls: string[]
}

// ==========================================
// 2. 配置与常量 (Configuration)
// ==========================================

// ★★★ 核心优化：网络映射表 ★★★
// Key 必须对应 API 返回的 "network" 字段值
// 以后如果后端支持了 Polygon，只需在这里添加配置，无需修改业务逻辑
const NETWORK_MAP: Record<string, ChainConfig> = {
  'base-sepolia': {
    chainIdHex: '0x14a34', // 84532
    chainIdDec: 84532,
    chainName: 'Base Sepolia',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  },
  // 示例：扩展支持 Sepolia 测试网
  'sepolia': {
    chainIdHex: '0xaa36a7',
    chainIdDec: 11155111,
    chainName: 'Sepolia',
    nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.sepolia.org'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  }
}

// ==========================================
// 3. 状态管理 (State Management)
// ==========================================
const user = ref<any>(null)
const loading = ref(false)
const error = ref('')

// API 实例
const api = axios.create({
  baseURL: '/api', // 请根据实际后端地址修改
  withCredentials: true
})

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
  } catch (err) {
    user.value = null
  }
}

async function connectAndLogin() {
  error.value = ''
  loading.value = true
  try {
    if (!(window as any).ethereum) throw new Error('Please install MetaMask.')

    const provider = new BrowserProvider((window as any).ethereum)
    const signer = await provider.getSigner()
    const address = await signer.getAddress()
    const network = await provider.getNetwork()

    // 1. Get Nonce
    const nonceRes = await api.get('/user/nonce', { params: { address } })
    const nonce = getResponseData(nonceRes)

    // 2. Create SIWE Message
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in to Access Resources',
      uri: window.location.origin,
      version: '1',
      chainId: Number(network.chainId),
      nonce,
    })

    const preparedMessage = message.prepareMessage()
    const signature = await signer.signMessage(preparedMessage)

    // 3. Verify
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
// 5. 区块链工具函数 (Blockchain Helpers)
// ==========================================

/**
 * 检查并切换到指定网络，如果不存在则自动添加
 */
async function ensureNetwork(provider: BrowserProvider, config: ChainConfig) {
  const network = await provider.getNetwork()

  // 如果已经在目标网络，直接返回
  if (Number(network.chainId) === config.chainIdDec) return

  try {
    // 尝试切换
    await provider.send('wallet_switchEthereumChain', [{ chainId: config.chainIdHex }])
  } catch (switchError: any) {
    // Error 4902: 链未添加到钱包
    if (switchError.code === 4902 || switchError.error?.code === 4902) {
      const { chainIdDec, chainIdHex, ...params } = config
      // 添加网络
      await provider.send('wallet_addEthereumChain', [{ chainId: chainIdHex, ...params }])
    } else {
      throw switchError
    }
  }
}

/**
 * 将交易哈希包装成 x402 协议要求的 Base64 JSON 格式
 */
function createPaymentToken(txHash: string, chainId: number) {
  // 1. 构造对象：x402 的 exact 模式通常至少需要 hash
  //有些实现可能还需要 chainId，带上比较保险
  const payload = {
    hash: txHash,
    chainId: chainId 
  }

  // 2. 序列化为 JSON 字符串
  const jsonString = JSON.stringify(payload)

  // 3. 转为 Base64 (浏览器原生方法)
  // 解决中文或特殊字符可能导致的编码问题（虽然 hash 里没有，但为了通用性）
  return window.btoa(jsonString)
}

/**
 * 执行链上支付通用逻辑
 */
async function executePayment(option: X402Option, config: ChainConfig) {
  if (!(window as any).ethereum) throw new Error('No crypto wallet found')

  const provider = new BrowserProvider((window as any).ethereum)

  // 1. 确保网络正确（根据传入的配置）
  await ensureNetwork(provider, config)

  const signer = await provider.getSigner()

  // 2. 实例化 Token 合约 (Generic ERC20 ABI)
  const erc20Abi = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address owner) view returns (uint256)'
  ]
  // 使用 API 返回的 asset (Token Address)
  const tokenContract = new Contract(option.asset, erc20Abi, signer) as any

  // 2.1 检查余额 (Pre-flight Check)
  const userAddress = await signer.getAddress()
  const balance = await tokenContract.balanceOf(userAddress)
  const requiredAmount = BigInt(option.maxAmountRequired)
  
  if (balance < requiredAmount) {
    throw new Error(`Insufficient Token Balance. You need ${requiredAmount} units of the token, but you only have ${balance}.`)
  }

  console.log(`[Payment] Paying ${option.maxAmountRequired} to ${option.payTo} on ${config.chainName}`)

  // 3. 发起转账
  // 使用 API 返回的 payTo 和 amount
  const tx = await tokenContract.transfer(option.payTo, option.maxAmountRequired)

  // 4. 等待上链确认 (1个区块确认即可)
  await tx.wait(1)

  return tx.hash
}

// ==========================================
// 6. 业务核心：处理支付与重试 (Payment Flow)
// ==========================================

/**
 * 在 API 返回的选项和前端配置之间寻找交集
 */
function findBestPaymentOption(accepts: X402Option[]): { option: X402Option, config: ChainConfig } {
  for (const option of accepts) {
    // 尝试用 network 字段去前端的 Map 里找配置
    const config = NETWORK_MAP[option.network]
    if (config) {
      return { option, config } // 找到了双方都支持的方案
    }
  }
  // 如果遍历完都没找到支持的网络
  throw new Error(`No supported payment network found. Server accepts: ${accepts.map(o => o.network).join(', ')}`)
}

async function handlePayment(plan: string) {
  loading.value = true
  error.value = ''

  try {
    // A. 第一次尝试请求资源
    const res = await api.get(`/payment/${plan}`)
    handleSuccess(res)

  } catch (err: any) {
    // B. 捕获 402 错误
    if (err.response && err.response.status === 402) {
      try {
        console.log('Starting x402 payment flow...')
        const { accepts } = err.response.data

        if (!accepts || !Array.isArray(accepts)) throw new Error('Invalid payment parameters')

        // 1. 动态匹配最佳支付方案
        const { option, config } = findBestPaymentOption(accepts)

        // 2. 唤起钱包支付 (逻辑完全解耦，只传参数)
        const txHash = await executePayment(option, config)
        console.log('Payment successful, Hash:', txHash)

        const paymentToken = createPaymentToken(txHash, config.chainIdDec)
        // 3. 携带支付凭证重试请求
        const retryRes = await api.get(`/payment/${plan}`, {
          headers: {
            'X-Payment': paymentToken
          }
        })

        handleSuccess(retryRes)

      } catch (payErr: any) {
        console.error('Payment failed:', payErr)
        // 用户拒绝或交易失败
        if (payErr.code === 'ACTION_REJECTED') {
          error.value = 'You rejected the transaction.'
        } else {
          error.value = payErr.message || 'Payment execution failed'
        }
      }
    } else {
      // 其他常规错误 (401, 500 etc)
      console.error(err)
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
