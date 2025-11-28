<script setup lang="ts">
import { ref, onMounted } from 'vue'
import axios from 'axios'

interface AccessKey {
  id: number
  name: string
  type: string
  accessKey: string
  secret: string
  dayCount: number
  dayCredits: number
  monthCount: number
  monthCredits: number
  totalCount: number
  totalCredits: number
}

interface KeyListResponse {
  dayCount: number
  dayCredits: number
  monthCount: number
  monthCredits: number
  totalCount: number
  totalCredits: number
  remainDays: number
  remainCredits: number
  rateLimit: number
  dailyLimit: number
  keyLimit: number
  keys: AccessKey[]
}

const api = axios.create({
  baseURL: '/api',
  withCredentials: true
})

const loading = ref(false)
const error = ref('')
const success = ref('')
const keys = ref<AccessKey[]>([])
const overview = ref<Omit<KeyListResponse, 'keys'> | null>(null)

// Dialog states
const showCreateDialog = ref(false)
const showEditDialog = ref(false)
const showDeleteConfirm = ref(false)

// Form data
const newKeyName = ref('')
const newKeyType = ref('AI_ORACLE')
const editingKey = ref<AccessKey | null>(null)
const editKeyName = ref('')
const deletingKey = ref<AccessKey | null>(null)

// Show/hide secrets
const visibleSecrets = ref<Set<string>>(new Set())

function getResponseData<T>(response: { data: { data?: T } | T }): T {
  return (response.data as { data?: T }).data || (response.data as T)
}

async function fetchKeys() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.get<{ data: KeyListResponse }>('/access-key')
    const data = getResponseData(res)
    keys.value = data.keys
    overview.value = {
      dayCount: data.dayCount,
      dayCredits: data.dayCredits,
      monthCount: data.monthCount,
      monthCredits: data.monthCredits,
      totalCount: data.totalCount,
      totalCredits: data.totalCredits,
      remainDays: data.remainDays,
      remainCredits: data.remainCredits,
      rateLimit: data.rateLimit,
      dailyLimit: data.dailyLimit,
      keyLimit: data.keyLimit,
    }
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = axiosErr.response?.data?.error || axiosErr.message || 'Failed to fetch keys'
  } finally {
    loading.value = false
  }
}

async function createKey() {
  if (!newKeyName.value.trim()) {
    error.value = 'Please enter a key name'
    return
  }

  loading.value = true
  error.value = ''
  try {
    await api.post('/access-key', {
      name: newKeyName.value.trim(),
      type: newKeyType.value,
    })
    success.value = 'Key created successfully'
    showCreateDialog.value = false
    newKeyName.value = ''
    await fetchKeys()
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = axiosErr.response?.data?.error || axiosErr.message || 'Failed to create key'
  } finally {
    loading.value = false
  }
}

function openEditDialog(key: AccessKey) {
  editingKey.value = key
  editKeyName.value = key.name
  showEditDialog.value = true
}

async function updateKey() {
  if (!editingKey.value || !editKeyName.value.trim()) {
    error.value = 'Please enter a key name'
    return
  }

  loading.value = true
  error.value = ''
  try {
    await api.put('/access-key', {
      id: editingKey.value.id,
      name: editKeyName.value.trim(),
    })
    success.value = 'Key updated successfully'
    showEditDialog.value = false
    editingKey.value = null
    editKeyName.value = ''
    await fetchKeys()
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = axiosErr.response?.data?.error || axiosErr.message || 'Failed to update key'
  } finally {
    loading.value = false
  }
}

function openDeleteConfirm(key: AccessKey) {
  deletingKey.value = key
  showDeleteConfirm.value = true
}

async function deleteKey() {
  if (!deletingKey.value) return

  loading.value = true
  error.value = ''
  try {
    await api.delete(`/access-key/${deletingKey.value.id}`)
    success.value = 'Key deleted successfully'
    showDeleteConfirm.value = false
    deletingKey.value = null
    await fetchKeys()
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = axiosErr.response?.data?.error || axiosErr.message || 'Failed to delete key'
  } finally {
    loading.value = false
  }
}

function toggleSecretVisibility(accessKey: string) {
  if (visibleSecrets.value.has(accessKey)) {
    visibleSecrets.value.delete(accessKey)
  } else {
    visibleSecrets.value.add(accessKey)
  }
  visibleSecrets.value = new Set(visibleSecrets.value) // Trigger reactivity
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text)
  success.value = `${label} copied to clipboard`
  setTimeout(() => { success.value = '' }, 2000)
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••••••'
  return secret.slice(0, 4) + '••••••••' + secret.slice(-4)
}

onMounted(() => {
  fetchKeys()
})
</script>

<template>
  <div class="access-key-manager">
    <div class="section-header">
      <h2>🔑 Access Keys</h2>
      <button @click="showCreateDialog = true" class="btn create-btn">
        + Create Key
      </button>
    </div>

    <!-- Overview Stats -->
    <div v-if="overview" class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Today</span>
        <span class="stat-value">{{ overview.dayCount }} calls</span>
        <span class="stat-credits">{{ overview.dayCredits }} credits</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">This Month</span>
        <span class="stat-value">{{ overview.monthCount }} calls</span>
        <span class="stat-credits">{{ overview.monthCredits }} credits</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Total</span>
        <span class="stat-value">{{ overview.totalCount }} calls</span>
        <span class="stat-credits">{{ overview.totalCredits }} credits</span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading && !keys.length" class="loading-state">
      <div class="spinner"></div>
      <p>Loading keys...</p>
    </div>

    <!-- Keys List -->
    <div v-else-if="keys.length" class="keys-list">
      <div v-for="key in keys" :key="key.accessKey" class="key-card">
        <div class="key-header">
          <div class="key-info">
            <span class="key-name">{{ key.name }}</span>
            <span class="key-type">{{ key.type }}</span>
          </div>
          <div class="key-actions">
            <button @click="openEditDialog(key)" class="icon-btn" title="Edit">✏️</button>
            <button @click="openDeleteConfirm(key)" class="icon-btn delete" title="Delete">🗑️</button>
          </div>
        </div>

        <div class="key-credentials">
          <div class="credential-row">
            <span class="credential-label">Access Key:</span>
            <code class="credential-value">{{ key.accessKey }}</code>
            <button @click="copyToClipboard(key.accessKey, 'Access Key')" class="copy-btn" title="Copy">📋</button>
          </div>
          <div class="credential-row">
            <span class="credential-label">Secret:</span>
            <code class="credential-value">
              {{ visibleSecrets.has(key.accessKey) ? key.secret : maskSecret(key.secret) }}
            </code>
            <button @click="toggleSecretVisibility(key.accessKey)" class="copy-btn" title="Toggle visibility">
              {{ visibleSecrets.has(key.accessKey) ? '🙈' : '👁️' }}
            </button>
            <button @click="copyToClipboard(key.secret, 'Secret')" class="copy-btn" title="Copy">📋</button>
          </div>
        </div>

        <div class="key-stats">
          <span>Today: {{ key.dayCount }} calls ({{ key.dayCredits }} credits)</span>
          <span>Month: {{ key.monthCount }} calls ({{ key.monthCredits }} credits)</span>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <p>No access keys yet. Create one to get started.</p>
    </div>

    <!-- Messages -->
    <div v-if="error" class="message error-msg">⚠️ {{ error }}</div>
    <div v-if="success" class="message success-msg">✅ {{ success }}</div>

    <!-- Create Dialog -->
    <div v-if="showCreateDialog" class="dialog-overlay" @click.self="showCreateDialog = false">
      <div class="dialog">
        <h3>Create New Access Key</h3>
        <div class="form-group">
          <label>Key Name</label>
          <input v-model="newKeyName" type="text" placeholder="e.g., Production API Key" />
        </div>
        <div class="form-group">
          <label>Key Type</label>
          <select v-model="newKeyType">
            <option value="AI_ORACLE">AI Oracle</option>
          </select>
        </div>
        <div class="dialog-actions">
          <button @click="showCreateDialog = false" class="btn cancel-btn">Cancel</button>
          <button @click="createKey" class="btn primary-btn" :disabled="loading">
            {{ loading ? 'Creating...' : 'Create' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Dialog -->
    <div v-if="showEditDialog" class="dialog-overlay" @click.self="showEditDialog = false">
      <div class="dialog">
        <h3>Edit Access Key</h3>
        <div class="form-group">
          <label>Key Name</label>
          <input v-model="editKeyName" type="text" placeholder="Enter new name" />
        </div>
        <div class="dialog-actions">
          <button @click="showEditDialog = false" class="btn cancel-btn">Cancel</button>
          <button @click="updateKey" class="btn primary-btn" :disabled="loading">
            {{ loading ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Confirm Dialog -->
    <div v-if="showDeleteConfirm" class="dialog-overlay" @click.self="showDeleteConfirm = false">
      <div class="dialog">
        <h3>Delete Access Key</h3>
        <p>Are you sure you want to delete "<strong>{{ deletingKey?.name }}</strong>"? This action cannot be undone.</p>
        <div class="dialog-actions">
          <button @click="showDeleteConfirm = false" class="btn cancel-btn">Cancel</button>
          <button @click="deleteKey" class="btn danger-btn" :disabled="loading">
            {{ loading ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.access-key-manager {
  margin-top: 2rem;
  padding: 1.5rem;
  background: #f8fafc;
  border-radius: 12px;
  text-align: left;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.section-header h2 {
  margin: 0;
  font-size: 1.25rem;
  color: #1a1a1a;
}

.create-btn {
  background: #10b981;
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.create-btn:hover {
  background: #059669;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  background: white;
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  text-align: center;
}

.stat-label {
  font-size: 0.75rem;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #1a1a1a;
  margin-top: 0.25rem;
}

.stat-credits {
  font-size: 0.85rem;
  color: #6b7280;
}

/* Keys List */
.keys-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.key-card {
  background: white;
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.key-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.key-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.key-name {
  font-weight: 600;
  color: #1a1a1a;
}

.key-type {
  font-size: 0.75rem;
  background: #e0e7ff;
  color: #4f46e5;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
}

.key-actions {
  display: flex;
  gap: 0.5rem;
}

.icon-btn {
  background: transparent;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.icon-btn:hover {
  background: #f3f4f6;
}

.icon-btn.delete:hover {
  background: #fee2e2;
}

/* Credentials */
.key-credentials {
  background: #f9fafb;
  padding: 0.75rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}

.credential-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.credential-row:last-child {
  margin-bottom: 0;
}

.credential-label {
  font-size: 0.8rem;
  color: #6b7280;
  min-width: 80px;
}

.credential-value {
  flex: 1;
  font-family: monospace;
  font-size: 0.85rem;
  color: #374151;
  background: transparent;
  word-break: break-all;
}

.copy-btn {
  background: transparent;
  border: none;
  font-size: 0.9rem;
  cursor: pointer;
  padding: 0.2rem;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.copy-btn:hover {
  opacity: 1;
}

/* Key Stats */
.key-stats {
  display: flex;
  gap: 1.5rem;
  font-size: 0.8rem;
  color: #6b7280;
}

/* Loading & Empty States */
.loading-state, .empty-state {
  text-align: center;
  padding: 2rem;
  color: #6b7280;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #0052ff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 0.5rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* Messages */
.message {
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 8px;
  font-size: 0.9rem;
}

.error-msg {
  background: #fff2f0;
  border: 1px solid #ffccc7;
  color: #cf1322;
}

.success-msg {
  background: #f0fff4;
  border: 1px solid #b7eb8f;
  color: #389e0d;
}

/* Dialog */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.dialog {
  background: white;
  padding: 1.5rem;
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.dialog h3 {
  margin: 0 0 1rem;
  color: #1a1a1a;
}

.dialog p {
  color: #6b7280;
  margin-bottom: 1rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
  margin-bottom: 0.5rem;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 1rem;
  box-sizing: border-box;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #0052ff;
  box-shadow: 0 0 0 3px rgba(0, 82, 255, 0.1);
}

.dialog-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
}

.btn {
  padding: 0.6rem 1.25rem;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  font-size: 0.9rem;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.primary-btn {
  background: #0052ff;
  color: white;
}

.primary-btn:hover:not(:disabled) {
  background: #0040d1;
}

.cancel-btn {
  background: #f3f4f6;
  color: #374151;
}

.cancel-btn:hover {
  background: #e5e7eb;
}

.danger-btn {
  background: #ef4444;
  color: white;
}

.danger-btn:hover:not(:disabled) {
  background: #dc2626;
}

/* Responsive */
@media (max-width: 600px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .key-stats {
    flex-direction: column;
    gap: 0.25rem;
  }

  .credential-row {
    flex-wrap: wrap;
  }

  .credential-value {
    width: 100%;
    order: 3;
    margin-top: 0.25rem;
  }
}
</style>
