
// SERVICE: Gửi dữ liệu về Google Sheet (Backend Apps Script)

// --- CẤU HÌNH ---
// URL Google Apps Script.
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx5ad3IA5TJ0DiLMu-lNh40NS48l5XWoI1QTN0OaMJQ9sgZF6cvuWhNBtbMj1WP9UqV1A/exec";

interface ApiResponse {
  status: 'success' | 'error';
  message: string;
  user?: { 
    username: string;
    permissions?: string;
    systemKey?: string; 
  };
  users?: any[]; 
}

// Fetch Public IP from a free service
export const getPublicIP = async (): Promise<string> => {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.warn("Could not fetch public IP", error);
    return "Unknown/Hidden";
  }
};

// Hàm gọi API chung
const callScript = async (payload: any, useKeepAlive = false): Promise<ApiResponse> => {
  if (GOOGLE_SCRIPT_URL.includes("example-replace-this")) {
    console.warn("Google Sheet Service: Chưa cập nhật Web App URL.");
    return { status: 'error', message: 'Chưa cấu hình Backend URL.' };
  }

  try {
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8", 
      },
      body: JSON.stringify(payload),
      keepalive: useKeepAlive, // CRITICAL for window close/unload events
    });

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
        return { status: 'error', message: 'Lỗi Backend: URL Google Script không hợp lệ.' };
    }

    if (!response.ok) {
        return { status: 'error', message: `HTTP Error: ${response.status}` };
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error("API Call Failed", error);
    return { status: 'error', message: 'Lỗi kết nối Server.' };
  }
};

export const registerUser = async (username: string, password: string): Promise<ApiResponse> => {
  const ip = await getPublicIP(); // Fetch IP for logging
  return callScript({
    action: 'register',
    username,
    password,
    ip // Send IP
  });
};

export const loginUser = async (username: string, password: string): Promise<ApiResponse> => {
  // Try to get IP before logging in
  const ip = await getPublicIP();
  
  // Cache IP in LocalStorage so we can access it synchronously during logout (beforeunload)
  try {
    localStorage.setItem('app_client_ip', ip);
  } catch (e) {
    console.warn("Could not cache IP");
  }

  return callScript({
    action: 'login',
    username,
    password,
    ip: ip // Send IP to backend
  });
};

// Call when user clicks Logout OR Closes tab
export const logoutUser = (username: string): void => {
    // Attempt to get cached IP for logging
    let ip = "Unknown";
    try {
        ip = localStorage.getItem('app_client_ip') || "Unknown";
    } catch (e) {}

    // Fire and forget, use keepalive to ensure request completes even if tab closes
    callScript({
        action: 'logout',
        username: username,
        ip: ip
    }, true).catch(err => console.warn("Logout beacon failed", err));
};

// Periodic heartbeat to keep user "Online"
export const sendHeartbeat = async (username: string): Promise<void> => {
    return callScript({
        action: 'heartbeat',
        username: username,
    }).then(() => {}); // Fire and forget
};

export const saveSystemConfig = async (apiKey: string): Promise<ApiResponse> => {
  return callScript({
    action: 'save_config',
    apiKey
  });
};

export const getUsers = async (): Promise<ApiResponse> => {
  return callScript({
    action: 'get_users'
  });
};

export const updateUserPermission = async (targetUser: string, newPermission: string): Promise<ApiResponse> => {
  return callScript({
    action: 'update_permission',
    targetUser,
    newPermission
  });
};

export const sendDataToSheet = async (
  images: string[], 
  prompt: string,
  description: string,
  username: string
): Promise<void> => {
  const result = await callScript({
    action: 'log_design',
    username: username,
    images: images, 
    prompt: prompt,
    description: description
  });
  
  if (result.status === 'error') {
      console.warn("Logging failed:", result.message);
  }
};
