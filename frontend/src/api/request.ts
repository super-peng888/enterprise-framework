import axios from 'axios'
import { useAuthStore } from '@/stores/auth'

/**
 * 统一 axios 实例。
 * 联调真实后端时，直接使用 request 发请求即可（vite dev server 已把 /api 代理到
 * http://localhost:8090）；系统管理页面暂时走 src/mocks 下的本地假数据，
 * 各 api 文件里都保留了切换真实接口的注释。
 */
const request = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

request.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export default request
