
// SERVICE: Gửi dữ liệu về Google Sheet (Backend Apps Script)

// --- CẤU HÌNH ---
// URL Google Apps Script. Nếu URL này bị lỗi (404), các chức năng Online (Login/Log) sẽ hỏng, 
// nhưng chức năng xử lý ảnh (Gemini) vẫn hoạt động nếu Key đúng.
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx5ad3IA5TJ0DiLMu-lNh40NS48l5XWoI1QTN0OaMJQ9sgZF6cvuWhNBtbMj1WP9UqV1A/exec";

interface ApiResponse {
  status: 'success' | 'error';
  message: string;
  user?: { 
    username: string;
    permissions?: string;
    systemKey?: string; // Added systemKey
  };
}

// Hàm gọi API chung
const callScript = async (payload: any): Promise<ApiResponse> => {
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
    });

    // Check content type to avoid parsing HTML 404 pages as JSON
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
        console.error("Backend Error: Google Script URL returned HTML (Likely 404 Not Found or Permissions Error).");
        return { status: 'error', message: 'Lỗi Backend: URL Google Script không hợp lệ hoặc đã bị xóa.' };
    }

    if (!response.ok) {
        return { status: 'error', message: `HTTP Error: ${response.status}` };
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error("API Call Failed", error);
    // Return error but don't crash the app
    return { status: 'error', message: 'Lỗi kết nối Server (Network Error).' };
  }
};

export const registerUser = async (username: string, password: string): Promise<ApiResponse> => {
  return callScript({
    action: 'register',
    username,
    password
  });
};

export const loginUser = async (username: string, password: string): Promise<ApiResponse> => {
  return callScript({
    action: 'login',
    username,
    password
  });
};

export const saveSystemConfig = async (apiKey: string): Promise<ApiResponse> => {
  return callScript({
    action: 'save_config',
    apiKey
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
