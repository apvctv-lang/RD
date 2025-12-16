
// SERVICE: Gửi dữ liệu về Google Sheet (Backend Apps Script)

// --- CẤU HÌNH ---
// Thay thế URL bên dưới bằng Web App URL bạn nhận được khi deploy Google Apps Script (từ file BeDS.txt)
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx5ad3IA5TJ0DiLMu-lNh40NS48l5XWoI1QTN0OaMJQ9sgZF6cvuWhNBtbMj1WP9UqV1A/exec";

interface ApiResponse {
  status: 'success' | 'error';
  message: string;
  user?: { 
    username: string;
    permissions?: string; // Added permissions field
  };
}

// Hàm gọi API chung
const callScript = async (payload: any): Promise<ApiResponse> => {
  if (GOOGLE_SCRIPT_URL.includes("example-replace-this")) {
    console.warn("Google Sheet Service: Chưa cập nhật Web App URL.");
    return { status: 'error', message: 'Chưa cấu hình Backend URL.' };
  }

  try {
    // Google Apps Script Web App chuyển hướng 302, fetch mặc định sẽ follow.
    // Để nhận kết quả JSON, ta dùng post method thông thường.
    // Lưu ý: Cần deploy script với quyền "Anyone" thì mới không bị chặn CORS preflight nghiêm ngặt.
    
    // Cách tốt nhất để debug CORS với GAS là dùng form-data hoặc text/plain để tránh preflight OPTIONS phức tạp
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      // Dùng text/plain để tránh trình duyệt gửi preflight request (OPTIONS) gây lỗi CORS trên GAS
      headers: {
        "Content-Type": "text/plain;charset=utf-8", 
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    return result;

  } catch (error) {
    console.error("API Call Failed", error);
    return { status: 'error', message: 'Lỗi kết nối Server.' };
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

export const sendDataToSheet = async (
  images: string[], 
  prompt: string,
  description: string,
  username: string
): Promise<void> => {
  await callScript({
    action: 'log_design',
    username: username,
    images: images, // Lưu ý: GAS có thể bị lỗi nếu payload quá lớn (ảnh base64).
    prompt: prompt,
    description: description
  });
};