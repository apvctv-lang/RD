
import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Layers, CreditCard, Zap, Trash2, FileJson, User, HelpCircle, Rocket, Clock } from 'lucide-react';
import { validateToken } from '../services/geminiService';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (freeKeys: string[], paidKeys: string[]) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSave }) => {
  const [freeKeysInput, setFreeKeysInput] = useState('');
  const [paidKeysInput, setPaidKeysInput] = useState('');
  const [tokenJsonInput, setTokenJsonInput] = useState('');
  
  const [status, setStatus] = useState<'idle' | 'validating' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [detailedError, setDetailedError] = useState<{title: string, advice: string} | null>(null);
  const [detectedUser, setDetectedUser] = useState<{name: string, email: string, image: string} | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStatus('idle');
      setStatusMessage('');
      setDetailedError(null);
      
      const storedFree = localStorage.getItem('gemini_pool_free');
      const storedPaid = localStorage.getItem('gemini_pool_paid');
      const storedToken = localStorage.getItem('gemini_raw_token_json');
      
      if (storedFree) setFreeKeysInput(JSON.parse(storedFree).join('\n'));
      if (storedPaid) {
          const paidList = JSON.parse(storedPaid);
          const cleanPaidList = paidList.filter((k: string) => !k.startsWith('ya29'));
          setPaidKeysInput(cleanPaidList.join('\n'));
      }
      if (storedToken) {
          setTokenJsonInput(storedToken);
          try {
              const parsed = JSON.parse(storedToken);
              if (parsed.user) setDetectedUser(parsed.user);
              if (parsed.expires) setTokenExpiry(new Date(parsed.expires).toLocaleString());
          } catch(e) {}
      }
    }
  }, [isOpen]);

  useEffect(() => {
      try {
          if (!tokenJsonInput.trim()) {
              setDetectedUser(null);
              setTokenExpiry(null);
              return;
          }
          // Attempt to parse JSON immediately for UI feedback
          let parsed;
          if (tokenJsonInput.trim().startsWith('{')) {
              parsed = JSON.parse(tokenJsonInput);
              if (parsed.user) setDetectedUser(parsed.user);
              if (parsed.expires) setTokenExpiry(new Date(parsed.expires).toLocaleString());
          } else if (tokenJsonInput.startsWith('ya29')) {
             setDetectedUser(null);
             setTokenExpiry("Token trực tiếp (Không có thông tin hết hạn)");
          }
      } catch (e) {
          // invalid json, ignore
      }
  }, [tokenJsonInput]);

  if (!isOpen) return null;

  const extractKeys = (input: string): string[] => {
    return input
      .split(/[\n,]+/)
      .map(k => k.trim())
      .filter(k => k.length > 10 && !k.startsWith('ya29'));
  };

  const handleSave = async () => {
    setDetailedError(null);
    const freeKeys = extractKeys(freeKeysInput);
    const manualPaidKeys = extractKeys(paidKeysInput);
    
    let tokenKey = "";
    if (tokenJsonInput.trim()) {
        try {
            // Try parsing as JSON first
            if (tokenJsonInput.trim().startsWith('{')) {
                 const parsed = JSON.parse(tokenJsonInput);
                 if (parsed.access_token) tokenKey = parsed.access_token;
                 else if (parsed.token) tokenKey = parsed.token;
            } else if (tokenJsonInput.startsWith('ya29')) {
                 tokenKey = tokenJsonInput.trim();
            }
        } catch (e) {
            // Fallback for raw string
            if (tokenJsonInput.startsWith('ya29')) tokenKey = tokenJsonInput.trim();
        }
    }

    const finalPaidKeys = [...manualPaidKeys];
    if (tokenKey) {
        finalPaidKeys.push(tokenKey);
        localStorage.setItem('gemini_raw_token_json', tokenJsonInput);
    } else {
        localStorage.removeItem('gemini_raw_token_json');
    }

    if (freeKeys.length === 0 && finalPaidKeys.length === 0) {
      setStatus('error');
      setStatusMessage('Vui lòng nhập ít nhất 1 API Key hoặc Token.');
      return;
    }

    setStatus('validating');
    setStatusMessage(`Đang kiểm tra kết nối...`);

    const keyToTest = tokenKey || manualPaidKeys[0] || freeKeys[0];

    try {
      await validateToken(keyToTest);
      
      setStatus('success');
      setStatusMessage(`Kết nối thành công! Sẵn sàng sử dụng.`);
      
      setTimeout(() => {
        onSave(freeKeys, finalPaidKeys);
      }, 800);

    } catch (error: any) {
      console.error("Validation failed", error);
      
      let title = "Kết nối thất bại";
      let advice = "Vui lòng kiểm tra lại Key.";
      let isSuspended = false;

      const msg = error.message || '';
      
      if (error.status === 403 || msg.includes('403') || msg.includes('suspended') || msg.includes('Permission denied')) {
          title = "TOKEN/KEY ĐÃ BỊ CHẶN (403)";
          advice = "Key hoặc Token này đã hết hạn hoặc bị Google khóa. Nếu dùng Token Labs, hãy lấy lại Token mới (Token thường chỉ sống 1 giờ).";
          isSuspended = true;
      } else if (error.status === 400 || msg.includes('400') || msg.includes('INVALID_ARGUMENT')) {
          title = "KEY KHÔNG HỢP LỆ (400 Bad Request)";
          advice = "Key bị sai định dạng hoặc copy thiếu ký tự. Hãy kiểm tra lại.";
      } else if (error.status === 429 || msg.includes('429')) {
          title = "HẾT QUOTA (429 Rate Limit)";
          advice = "Key này đã hết lượt dùng miễn phí hôm nay/phút này. Hãy thử Key khác.";
      }

      setDetailedError({ title, advice });
      setStatus('error');
      setStatusMessage(title);

      // Nếu không phải lỗi Suspended nghiêm trọng, cho phép lưu cưỡng bức
      if (!isSuspended) {
          const confirm = window.confirm(`${title}\n\n${advice}\n\nBạn có muốn lưu không?`);
          if (confirm) onSave(freeKeys, finalPaidKeys);
      }
    }
  };

  const clearAll = () => {
    setFreeKeysInput('');
    setPaidKeysInput('');
    setTokenJsonInput('');
    setDetectedUser(null);
    setTokenExpiry(null);
    setStatus('idle');
    setDetailedError(null);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative transform overflow-hidden rounded-2xl bg-slate-900 shadow-2xl transition-all w-full max-w-4xl animate-fade-in border border-slate-800">
          
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900">
            <h3 className="text-lg font-bold text-slate-200 flex items-center">
              <Layers className="w-5 h-5 mr-2 text-indigo-500" />
              Quản lý API Key Pool
            </h3>
            <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-full hover:bg-slate-800 transition-colors">
              <X size={20} />
            </button>
          </div>
          
          <div className="p-6 space-y-6">
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                <div className="space-y-2">
                   <label className="flex items-center justify-between text-sm font-bold text-slate-300">
                      <div className="flex items-center">
                        <Zap size={14} className="mr-1 text-amber-500" />
                        Free Keys (Pool 1)
                      </div>
                      <span className="text-xs bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                        {extractKeys(freeKeysInput).length}
                      </span>
                   </label>
                   <textarea 
                      value={freeKeysInput}
                      onChange={(e) => setFreeKeysInput(e.target.value)}
                      placeholder="AIza... (Mỗi dòng 1 key)"
                      className="w-full h-64 p-3 text-xs font-mono bg-slate-950 border border-slate-700 text-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none placeholder:text-slate-600"
                   />
                </div>

                 <div className="space-y-2">
                   <label className="flex items-center justify-between text-sm font-bold text-slate-300">
                      <div className="flex items-center">
                        <CreditCard size={14} className="mr-1 text-green-500" />
                        Paid Keys (Pool 2)
                      </div>
                      <span className="text-xs bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                        {extractKeys(paidKeysInput).length}
                      </span>
                   </label>
                   <textarea 
                      value={paidKeysInput}
                      onChange={(e) => setPaidKeysInput(e.target.value)}
                      placeholder="AIza... (Billing Enabled)&#10;Mỗi dòng 1 key"
                      className="w-full h-64 p-3 text-xs font-mono bg-slate-950 border border-slate-700 text-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none placeholder:text-slate-600"
                   />
                </div>

                <div className="space-y-2">
                   <label className="flex items-center justify-between text-sm font-bold text-slate-300">
                      <div className="flex items-center text-purple-400">
                        <Rocket size={14} className="mr-1" />
                        Labs / Flow Ultra JSON
                      </div>
                      {detectedUser && (
                          <span className="text-xs text-green-400 flex items-center bg-green-950/30 px-2 py-0.5 rounded border border-green-900">
                              <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1"></span> Ready
                          </span>
                      )}
                   </label>
                   <textarea 
                      value={tokenJsonInput}
                      onChange={(e) => setTokenJsonInput(e.target.value)}
                      placeholder='Dán toàn bộ JSON từ Labs vào đây:&#10;{"user":..., "access_token":"ya29..."}'
                      className="w-full h-64 p-3 text-xs font-mono bg-slate-950 border border-slate-700 text-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none resize-none placeholder:text-slate-600"
                   />
                   
                   {/* User Info Card */}
                   {detectedUser ? (
                       <div className="flex flex-col space-y-2 p-2 bg-slate-800 rounded-lg border border-slate-700 animate-fade-in">
                           <div className="flex items-center">
                               <img src={detectedUser.image} alt="Avatar" className="w-8 h-8 rounded-full mr-3 border border-slate-600" />
                               <div className="overflow-hidden">
                                   <p className="text-xs font-bold text-white truncate">{detectedUser.name}</p>
                                   <p className="text-[10px] text-slate-400 truncate">{detectedUser.email}</p>
                               </div>
                           </div>
                           {tokenExpiry && (
                               <div className="text-[10px] text-amber-400 flex items-center pt-1 border-t border-slate-700">
                                   <Clock size={10} className="mr-1" />
                                   Hết hạn: {tokenExpiry}
                               </div>
                           )}
                       </div>
                   ) : (
                       <p className="text-[10px] text-slate-500 italic px-1">
                           Hỗ trợ: Token "ya29..." hoặc JSON đầy đủ
                       </p>
                   )}
                </div>
            </div>

            {/* ERROR DETAILS BOX */}
            {detailedError && (
              <div className="p-4 bg-red-950/40 border border-red-900 rounded-xl animate-fade-in flex items-start">
                  <AlertCircle className="w-6 h-6 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
                  <div>
                      <h4 className="font-bold text-red-400 text-sm">{detailedError.title}</h4>
                      <p className="text-red-200/80 text-xs mt-1 leading-relaxed">{detailedError.advice}</p>
                  </div>
              </div>
            )}

            {/* Status Bar (Non-Error) */}
            {status !== 'idle' && status !== 'error' && (
               <div className={`p-3 rounded-lg flex items-center ${status === 'success' ? 'bg-green-950/30 text-green-400 border border-green-900' : 'bg-indigo-950/30 text-indigo-400 border border-indigo-900'}`}>
                  {status === 'validating' && <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />}
                  {status === 'success' && <CheckCircle size={18} className="mr-2" />}
                  <span className="font-medium text-sm">{statusMessage}</span>
               </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t border-slate-800">
              <button onClick={clearAll} className="text-xs text-slate-500 hover:text-red-400 flex items-center transition-colors">
                <Trash2 size={14} className="mr-1" /> Xóa tất cả
              </button>
              <div className="flex space-x-3">
                <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 rounded-lg transition-colors">
                    Đóng
                </button>
                <button
                    onClick={handleSave}
                    disabled={status === 'validating'}
                    className="px-6 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm shadow-indigo-500/20"
                >
                    {status === 'error' ? 'Thử lại' : 'Lưu & Kết nối'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
