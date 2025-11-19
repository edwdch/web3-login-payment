<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { BrowserProvider } from 'ethers'
import { SiweMessage } from 'siwe'
import axios from 'axios'

const user = ref<any>(null)
const loading = ref(false)
const error = ref('')

const api = axios.create({
  baseURL: '/api',
  withCredentials: true // Important for cookies
})

function getResponseData(response: any) {
  return response.data.data
}

async function checkSession() {
  try {
    loading.value = true
    const res = await api.get('/user/me')
    user.value = getResponseData(res).user
  } catch (err) {
    // Not logged in
    user.value = null
  } finally {
    loading.value = false
  }
}

async function connectAndLogin() {
  error.value = ''
  loading.value = true
  try {
    if (!(window as any).ethereum) {
      throw new Error('No crypto wallet found. Please install MetaMask.')
    }

    const provider = new BrowserProvider((window as any).ethereum)
    const signer = await provider.getSigner()
    const address = await signer.getAddress()
    const network = await provider.getNetwork()
    const chainId = Number(network.chainId)

    // 1. Get Nonce
    const nonceRes = await api.get('/user/nonce', { params: { address } })
    const nonce = getResponseData(nonceRes)

    // 2. Create SIWE Message
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in APRO API Hub',
      uri: window.location.origin,
      version: '1',
      chainId,
      nonce,
    })

    const preparedMessage = message.prepareMessage()

    // 3. Sign Message
    const signature = await signer.signMessage(preparedMessage)

    // 4. Verify
    const verifyRes = await api.post('/user/verify', {
      message: preparedMessage,
      signature,
    })

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
  } catch (err) {
    console.error(err)
  }
}

onMounted(() => {
  checkSession()
})
</script>

<template>
  <main>
    <div class="container">
      <h1>Web3 Login Demo</h1>
      
      <div v-if="loading" class="loading">Loading...</div>
      
      <div v-else-if="user" class="user-info">
        <p>Welcome, {{ user.publicAddress }}</p>
        <p>User ID: {{ user.id }}</p>
        <button @click="logout">Logout</button>
      </div>

      <div v-else class="login-form">
        <button @click="connectAndLogin">Connect Wallet & Login</button>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.container {
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

button {
  padding: 0.5rem 1rem;
  font-size: 1rem;
  cursor: pointer;
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
}

button:hover {
  background-color: #45a049;
}

.error {
  color: red;
  margin-top: 1rem;
}

.user-info {
  background: #f5f5f5;
  padding: 1rem;
  border-radius: 8px;
  color: #333;
}
</style>
