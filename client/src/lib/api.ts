import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const API_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  import.meta.env.VITE_RENDER_API_URL?.replace(/\/$/, "") ||
  "https://ai-guardian-women-safety.onrender.com";

const api = axios.create({
  baseURL: `${API_URL}/api`,
});

export function getTokens() {
  return {
    access: localStorage.getItem("gs_access_token"),
    refresh: localStorage.getItem("gs_refresh_token"),
  };
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("gs_access_token", access);
  localStorage.setItem("gs_refresh_token", refresh);
}

export function clearTokens() {
  localStorage.removeItem("gs_access_token");
  localStorage.removeItem("gs_refresh_token");
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { access } = getTokens();
  if (access && config.headers) {
    config.headers.Authorization = `Bearer ${access}`;
  }
  return config;
});

let isRefreshing = false;
let pendingQueue: Array<() => void> = [];

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry && originalRequest.url !== "/auth/login") {
      const { refresh } = getTokens();
      if (!refresh) {
        clearTokens();
        window.location.href = "/login";
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          pendingQueue.push(() => resolve(api(originalRequest)));
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;
      try {
        const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refresh_token: refresh });
        setTokens(data.access_token, data.refresh_token);
        pendingQueue.forEach((cb) => cb());
        pendingQueue = [];
        return api(originalRequest);
      } catch (refreshError) {
        clearTokens();
        window.location.href = "/login";
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
