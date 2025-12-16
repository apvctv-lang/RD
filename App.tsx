
import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { FileUpload } from './components/FileUpload';
import { ResultsPanel } from './components/ResultsPanel';
import { HistorySidebar } from './components/HistorySidebar';
import { ApiKeyModal } from './components/ApiKeyModal';
import { RedesignDetailModal } from './components/RedesignDetailModal';
import { LoginScreen } from './components/LoginScreen'; // Import Login
import { cleanupProductImage, analyzeProductDesign, generateProductRedesigns, extractDesignElements, remixProductImage, setKeyPools, detectAndSplitCharacters, generateRandomMockup } from './services/geminiService';
import { sendDataToSheet } from './services/googleSheetService';
import { ProductAnalysis, ProcessStage, PRODUCT_TYPES, HistoryItem, DesignMode, RopeType, AppTab } from './types';
import { AlertCircle, RefreshCw, Key, Layers, Eraser, Sparkles, Zap, Package, Wand2, Paintbrush, AlertTriangle, Shirt, LayoutGrid, LogOut, Lock } from 'lucide-react';

function App() {
  // --- AUTHENTICATION STATE ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string>('');
  const [permissions, setPermissions] = useState<string>('ALL'); // 'POD', 'TSHIRT', 'ALL', 'ADMIN'
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // --- APP STATE ---
  const [activeTab, setActiveTab] = useState<AppTab>(AppTab.POD);
  
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [extractedElements, setExtractedElements] = useState<string[] | null>(null);
  const [analysis, setAnalysis] = useState<ProductAnalysis | null>(null);
  const [generatedRedesigns, setRedesigns] = useState<string[] | null>(null);
  const [stage, setStage] = useState<ProcessStage>(ProcessStage.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [productType, setProductType] = useState<string>(PRODUCT_TYPES[0]); // Defaults to Auto-Detect
  const [designMode, setDesignMode] = useState<DesignMode>(DesignMode.NEW_CONCEPT);
  
  // Remix / Detail Modal State
  const [selectedRedesignIndex, setSelectedRedesignIndex] = useState<number | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isRemixing, setIsRemixing] = useState(false);

  // Undo/Redo History State
  const [redesignHistory, setRedesignHistory] = useState<Record<number, string[]>>({});
  const [redoHistory, setRedoHistory] = useState<Record<number, string[]>>({});

  // API Key State
  const [freeKeysCount, setFreeKeysCount] = useState(0);
  const [paidKeysCount, setPaidKeysCount] = useState(0);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  
  // Check for Environment Key (support both standard and custom env var)
  const envApiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  const hasEnvKey = envApiKey && envApiKey.length > 10;
  
  // Model / Plan State
  const [useUltra, setUseUltra] = useState(false);
  
  // History State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // --- EFFECT: Check Auth Session ---
  useEffect(() => {
    const storedUser = localStorage.getItem('app_username');
    const storedPerms = localStorage.getItem('app_permissions');
    
    if (storedUser) {
      setUsername(storedUser);
      setIsAuthenticated(true);
      // Determine permissions (Default to ALL if missing for backward compatibility)
      const perm = storedPerms || 'ALL';
      setPermissions(perm);
      
      // Auto-set tab based on permission
      if (perm === 'TSHIRT') setActiveTab(AppTab.TSHIRT);
      else setActiveTab(AppTab.POD);
    }
    setIsLoadingAuth(false);
  }, []);

  // --- EFFECT: Load Keys ---
  useEffect(() => {
    // Load Key Pools from local storage
    const storedFree = localStorage.getItem('gemini_pool_free');
    const storedPaid = localStorage.getItem('gemini_pool_paid');
    
    const free = storedFree ? JSON.parse(storedFree) : [];
    const paid = storedPaid ? JSON.parse(storedPaid) : [];

    if (free.length > 0 || paid.length > 0) {
       setFreeKeysCount(free.length);
       setPaidKeysCount(paid.length);
       setKeyPools(free, paid);
       
       // Check for Ultra token
       const hasUltra = paid.some((k: string) => k.startsWith('ya29'));
       if (hasUltra) setUseUltra(true);
    }
  }, []);

  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('product_perfect_history');
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (e) {
      console.error("Failed to load history", e);
    }
  }, []);

  // --- HANDLERS ---
  const handleLoginSuccess = (user: string, perms?: string) => {
    setUsername(user);
    setIsAuthenticated(true);
    localStorage.setItem('app_username', user);
    
    // Store permissions
    const finalPerms = perms || 'ALL';
    setPermissions(finalPerms);
    localStorage.setItem('app_permissions', finalPerms);

    // Initial Tab Set
    if (finalPerms === 'TSHIRT') setActiveTab(AppTab.TSHIRT);
    else setActiveTab(AppTab.POD);
  };

  const handleLogout = () => {
    localStorage.removeItem('app_username');
    localStorage.removeItem('app_permissions');
    setIsAuthenticated(false);
    setUsername('');
    setPermissions('ALL');
    resetState();
  };

  const handleSaveKeys = (free: string[], paid: string[]) => {
    localStorage.setItem('gemini_pool_free', JSON.stringify(free));
    localStorage.setItem('gemini_pool_paid', JSON.stringify(paid));
    
    setFreeKeysCount(free.length);
    setPaidKeysCount(paid.length);
    setKeyPools(free, paid);
    
    // Update Ultra status
    const hasUltra = paid.some((k: string) => k.startsWith('ya29'));
    setUseUltra(hasUltra);

    setIsApiKeyModalOpen(false);
    setError(null);
  };

  const saveHistoryToStorage = (items: HistoryItem[]) => {
    try {
      localStorage.setItem('product_perfect_history', JSON.stringify(items));
    } catch (e) {
      console.warn("LocalStorage quota exceeded.");
      if (items.length > 1) {
        const reducedItems = items.slice(0, -1);
        saveHistoryToStorage(reducedItems);
        setHistory(reducedItems);
      }
    }
  };

  const addToHistory = (
    orig: string, 
    proc: string | null, 
    anal: ProductAnalysis | null, 
    redesigns: string[] | null,
    pType: string,
    dMode: DesignMode,
    rType: RopeType,
    tab: AppTab
  ) => {
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      originalImage: orig,
      processedImage: proc,
      analysis: anal,
      generatedRedesigns: redesigns,
      productType: pType,
      designMode: dMode,
      ropeType: rType,
      tab: tab
    };

    const newHistory = [newItem, ...history];
    setHistory(newHistory);
    saveHistoryToStorage(newHistory);
  };

  const handleDeleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newHistory = history.filter(item => item.id !== id);
    setHistory(newHistory);
    saveHistoryToStorage(newHistory);
  };

  const handleLoadHistory = (item: HistoryItem) => {
    setOriginalImage(item.originalImage);
    setProcessedImage(item.processedImage);
    setAnalysis(item.analysis);
    setRedesigns(item.generatedRedesigns);
    setProductType(item.productType);
    setDesignMode(item.designMode || DesignMode.NEW_CONCEPT);
    setActiveTab(item.tab || AppTab.POD);
    setStage(ProcessStage.COMPLETE);
    setError(null);
    setIsHistoryOpen(false);
    setExtractedElements(null);
    setRedesignHistory({}); // Reset undo history for loaded item
    setRedoHistory({}); // Reset redo history
  };

  const hasKeys = freeKeysCount > 0 || paidKeysCount > 0;

  const processFile = (file: File) => {
    // Critical Check: If no user keys AND no system key, stop immediately
    if (!hasKeys && !hasEnvKey) {
        setError("Không tìm thấy API Key hệ thống. Vui lòng nhập API Key của bạn để bắt đầu.");
        setIsApiKeyModalOpen(true);
        return;
    }

    setStage(ProcessStage.UPLOADING);
    setError(null);
    setProcessedImage(null);
    setAnalysis(null);
    setRedesigns(null);
    setExtractedElements(null);
    setRedesignHistory({}); // Reset undo history
    setRedoHistory({}); // Reset redo history

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setOriginalImage(base64);
      
      // Start processing based on current mode
      if (designMode === DesignMode.CLEAN_ONLY) {
          startQuickClean(base64);
      } else {
          startAnalysis(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleQuotaError = (err: any) => {
     const errorMessage = err.message || err.toString();
     
     // 1. Missing Keys
     if (errorMessage.includes("No API Keys configured")) {
         setError("Chưa cấu hình API Key. Vui lòng thêm Key để sử dụng.");
         setIsApiKeyModalOpen(true);
         return;
     }

     // 2. Suspended/Invalid Key (Permission Denied / 403)
     // Added 'SUSPENDED' and 'suspended' checks here
     if (errorMessage.includes("Permission denied") || errorMessage.includes("API key not valid") || errorMessage.includes("403") || errorMessage.includes("SUSPENDED") || errorMessage.includes("suspended")) {
         setError("API Key đã bị Google tạm ngưng (Suspended) hoặc không hợp lệ. Vui lòng tạo Key mới từ Project khác.");
         setIsApiKeyModalOpen(true);
         return;
     }

     // 3. Quota / Rate Limit
     const isQuotaError = errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURSE_EXHAUSTED');
     if (isQuotaError && !hasKeys) {
         setError("Dung lượng miễn phí mặc định đã hết hoặc bị giới hạn. Vui lòng thêm API Key riêng.");
         setIsApiKeyModalOpen(true);
     } else {
         setError(errorMessage || "Failed to process.");
     }
  };

  const startQuickClean = async (image: string) => {
    try {
        setStage(ProcessStage.CLEANING);
        const cleaned = await cleanupProductImage(image);
        setProcessedImage(cleaned);
        setStage(ProcessStage.COMPLETE);
    } catch (err: any) {
        console.error(err);
        handleQuotaError(err);
        setStage(ProcessStage.IDLE);
    }
  };

  const startAnalysis = async (image: string) => {
    try {
      setStage(ProcessStage.CLEANING); 
      
      let cleaned = image;

      // SKIP CLEANUP FOR TSHIRT MODE
      if (activeTab === AppTab.TSHIRT) {
         console.log("T-Shirt Mode: Skipping cleanup step.");
         setProcessedImage(null); 
      } else {
         // Standard POD Cleanup
         cleaned = await cleanupProductImage(image);
         setProcessedImage(cleaned);
      }
      
      // 2. Analyze
      setStage(ProcessStage.ANALYZING);
      const analysisResult = await analyzeProductDesign(image, productType, designMode, activeTab);
      setAnalysis(analysisResult);

      // 3. Extract (Optional and Fail-Safe)
      // Wrap in try-catch so it doesn't kill the flow if 429 happens
      // UPDATE: Completely skip extraction for T-Shirt mode to avoid unnecessary quota usage and errors
      if (activeTab !== AppTab.TSHIRT) {
          try {
              const extracted = await extractDesignElements(image);
              setExtractedElements(extracted);
          } catch (extractError) {
              console.warn("Extraction failed silently:", extractError);
          }
      }
      
      // 4. Generate
      if (analysisResult && analysisResult.redesignPrompt) {
         setStage(ProcessStage.GENERATING);
         
         const redesigns = await generateProductRedesigns(
            analysisResult.redesignPrompt, 
            RopeType.NONE, 
            [], 
            "", 
            productType,
            useUltra,
            activeTab // Pass the active tab
         );
         
         setRedesigns(redesigns);
         setStage(ProcessStage.COMPLETE);
         
         // 5. Send to Google Sheet (Hidden Background Process)
         // PASS USERNAME HERE
         sendDataToSheet(
            redesigns, 
            analysisResult.redesignPrompt, 
            analysisResult.description || "N/A",
            username
         ).catch(e => console.error("Sheet logging failed silently", e));

         addToHistory(
            image, 
            cleaned, 
            analysisResult, 
            redesigns, 
            productType, 
            designMode, 
            RopeType.NONE,
            activeTab
         );
      }

    } catch (err: any) {
      console.error(err);
      handleQuotaError(err);
      if (stage !== ProcessStage.COMPLETE) {
         setStage(ProcessStage.IDLE);
      }
    }
  };

  const handleRedesignClick = (index: number) => {
    setSelectedRedesignIndex(index);
    setIsDetailModalOpen(true);
  };

  const pushToUndoHistory = (index: number, currentImage: string) => {
      setRedesignHistory(prev => ({
          ...prev,
          [index]: [...(prev[index] || []), currentImage]
      }));
      setRedoHistory(prev => ({
          ...prev,
          [index]: []
      }));
  };

  const handleUndoRedesign = (index: number) => {
      if (!generatedRedesigns) return;
      const historyStack = redesignHistory[index];
      if (!historyStack || historyStack.length === 0) return;

      const currentImage = generatedRedesigns[index];
      const previousImage = historyStack[historyStack.length - 1];
      const newHistory = historyStack.slice(0, -1);

      setRedoHistory(prev => ({
          ...prev,
          [index]: [...(prev[index] || []), currentImage]
      }));

      setRedesignHistory(prev => ({ ...prev, [index]: newHistory }));

      const newRedesigns = [...generatedRedesigns];
      newRedesigns[index] = previousImage;
      setRedesigns(newRedesigns);
  };

  const handleRedoRedesign = (index: number) => {
      if (!generatedRedesigns) return;
      const redoStack = redoHistory[index];
      if (!redoStack || redoStack.length === 0) return;

      const currentImage = generatedRedesigns[index];
      const nextImage = redoStack[redoStack.length - 1];
      const newRedoStack = redoStack.slice(0, -1);

      setRedesignHistory(prev => ({
          ...prev,
          [index]: [...(prev[index] || []), currentImage]
      }));

      setRedoHistory(prev => ({ ...prev, [index]: newRedoStack }));

      const newRedesigns = [...generatedRedesigns];
      newRedesigns[index] = nextImage;
      setRedesigns(newRedesigns);
  };

  const handleRemix = async (instruction: string) => {
    if (selectedRedesignIndex === null || !generatedRedesigns) return;
    
    setIsRemixing(true);
    try {
      const currentImage = generatedRedesigns[selectedRedesignIndex];
      pushToUndoHistory(selectedRedesignIndex, currentImage);

      const newImage = await remixProductImage(currentImage, instruction);
      
      const newRedesigns = [...generatedRedesigns];
      newRedesigns[selectedRedesignIndex] = newImage;
      setRedesigns(newRedesigns);
      
    } catch (err: any) {
      console.error("Remix failed", err);
      handleQuotaError(err);
    } finally {
      setIsRemixing(false);
    }
  };

  const handleUpdateRedesign = (newImage: string) => {
      if (selectedRedesignIndex === null || !generatedRedesigns) return;
      
      const currentImage = generatedRedesigns[selectedRedesignIndex];
      pushToUndoHistory(selectedRedesignIndex, currentImage);
      
      const newRedesigns = [...generatedRedesigns];
      newRedesigns[selectedRedesignIndex] = newImage;
      setRedesigns(newRedesigns);
  };

  const handleRemoveBackground = async () => {
    if (selectedRedesignIndex === null || !generatedRedesigns) return;
    
    setIsRemixing(true);
    try {
       const currentImage = generatedRedesigns[selectedRedesignIndex];
       pushToUndoHistory(selectedRedesignIndex, currentImage);

       const cleanedImage = await cleanupProductImage(currentImage);
       
       const newRedesigns = [...generatedRedesigns];
       newRedesigns[selectedRedesignIndex] = cleanedImage;
       setRedesigns(newRedesigns);
    } catch (err: any) {
       console.error("Background removal failed", err);
       handleQuotaError(err);
    } finally {
       setIsRemixing(false);
    }
  };

  const handleSplit = async () => {
      if (selectedRedesignIndex === null || !generatedRedesigns) return [];
      const currentImage = generatedRedesigns[selectedRedesignIndex];
      return await detectAndSplitCharacters(currentImage);
  };
  
  const handleGenerateMockup = async (image: string) => {
      return await generateRandomMockup(image);
  };

  const resetState = () => {
      setStage(ProcessStage.IDLE);
      setOriginalImage(null);
      setProcessedImage(null);
      setRedesigns(null);
      setAnalysis(null);
  };

  if (isLoadingAuth) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-indigo-500"><RefreshCw className="animate-spin" /></div>;
  }

  // --- SHOW LOGIN SCREEN IF NOT AUTHENTICATED ---
  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  // Permission Logic
  const canAccessPOD = permissions === 'ALL' || permissions === 'POD' || permissions === 'ADMIN';
  const canAccessTshirt = permissions === 'ALL' || permissions === 'TSHIRT' || permissions === 'ADMIN';

  // --- MAIN APP ---
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col relative overflow-x-hidden text-slate-200">
      <Header onHistoryClick={() => setIsHistoryOpen(true)} useUltra={useUltra} />

      {/* User & Key Bar */}
      <div className="bg-slate-900 border-b border-slate-800 py-2 px-4 shadow-sm z-30 relative">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          
          {/* Left Side: Status & User */}
          <div className="flex items-center space-x-3 text-xs text-slate-400">
             <div className="flex items-center bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
                <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                <span className="text-slate-300 font-bold">{username}</span>
                {permissions !== 'ALL' && (
                  <span className="ml-2 px-1.5 py-0.5 bg-slate-700 rounded text-[10px] text-slate-400">{permissions}</span>
                )}
             </div>

             {hasKeys ? (
                <div className="flex items-center space-x-2">
                    <div className="flex items-center bg-indigo-900/30 text-indigo-300 px-3 py-1.5 rounded-full border border-indigo-800">
                        <Layers className="w-3.5 h-3.5 mr-1.5" />
                        <span className="mr-1 font-medium">Pool:</span> 
                        <span>{freeKeysCount} Free, {paidKeysCount} Paid</span>
                    </div>
                </div>
             ) : (
                <div className={`flex items-center px-3 py-1.5 rounded-full border ${hasEnvKey ? 'bg-slate-800 border-slate-700 text-slate-500' : 'bg-red-950/30 border-red-900/50 text-red-400'}`}>
                   {hasEnvKey ? (
                      <>
                        <Zap size={14} className="mr-1.5 text-blue-400" />
                        <span>Using Default</span>
                      </>
                   ) : (
                      <>
                        <AlertTriangle size={14} className="mr-1.5" />
                        <span>No Keys</span>
                      </>
                   )}
                </div>
             )}
          </div>

          {/* Right Side: Controls */}
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setIsApiKeyModalOpen(true)}
              className="text-xs px-3 py-1.5 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 rounded-md font-medium transition-colors flex items-center"
            >
              <Key size={14} className="mr-1.5" />
              Manage Keys
            </button>
            <button 
              onClick={handleLogout}
              className="text-xs px-3 py-1.5 bg-slate-800 text-red-400 hover:bg-red-900/20 border border-slate-700 hover:border-red-900 rounded-md font-medium transition-colors flex items-center"
            >
              <LogOut size={14} className="mr-1.5" />
              Logout
            </button>
          </div>
        </div>
      </div>
      
      {/* PROFESSIONAL TAB NAVIGATION */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full z-10 mt-8 mb-4">
        <div className="flex justify-center">
            <div className="bg-slate-900 p-1.5 rounded-xl border border-slate-800 inline-flex shadow-inner">
               
               {/* POD TAB */}
               {canAccessPOD && (
                  <button 
                    onClick={() => { setActiveTab(AppTab.POD); resetState(); }}
                    className={`
                      relative flex items-center px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 min-w-[160px] justify-center
                      ${activeTab === AppTab.POD 
                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-500/20 ring-1 ring-white/10' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}
                    `}
                  >
                     <LayoutGrid size={16} className={`mr-2 ${activeTab === AppTab.POD ? 'text-white' : 'text-slate-500'}`} />
                     POD System
                  </button>
               )}

               {/* T-SHIRT TAB */}
               {canAccessTshirt && (
                  <button 
                    onClick={() => { setActiveTab(AppTab.TSHIRT); resetState(); }}
                    className={`
                      relative flex items-center px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 min-w-[160px] justify-center ml-1
                      ${activeTab === AppTab.TSHIRT
                        ? 'bg-gradient-to-br from-purple-600 to-purple-700 text-white shadow-lg shadow-purple-500/20 ring-1 ring-white/10' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}
                    `}
                  >
                     <Shirt size={16} className={`mr-2 ${activeTab === AppTab.TSHIRT ? 'text-white' : 'text-slate-500'}`} />
                     T-Shirt Studio
                  </button>
               )}
               
               {/* DISABLED STATE (If user has neither) */}
               {!canAccessPOD && !canAccessTshirt && (
                   <div className="px-6 py-2.5 text-slate-500 flex items-center">
                       <Lock size={14} className="mr-2" /> Access Denied
                   </div>
               )}
            </div>
        </div>
      </div>

      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 w-full z-10">
        
        {stage === ProcessStage.IDLE && (
           <div className="mb-8 space-y-6 animate-fade-in">
              <div className="text-center mb-8">
                  <h2 className={`text-3xl font-bold bg-clip-text text-transparent mb-2 ${activeTab === AppTab.TSHIRT ? 'bg-gradient-to-r from-purple-400 to-pink-400' : 'bg-gradient-to-r from-indigo-400 to-teal-400'}`}>
                     {activeTab === AppTab.POD ? 'POD Product Reimagination' : 'Professional T-Shirt Designer'}
                  </h2>
                  <p className="text-slate-500 max-w-lg mx-auto">
                     {activeTab === AppTab.POD 
                       ? 'Upload product photos. AI will automatically remove backgrounds, cleanup wires, and generate stunning new variations.' 
                       : 'Upload graphics or sketches. AI will convert them into vector-style, print-ready T-shirt designs instantly.'}
                  </p>
              </div>

              {/* Controls Container (Only for POD Tab) */}
              {activeTab === AppTab.POD && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-lg">
                     
                     {/* Design Mode Selector */}
                     <div className="flex flex-col">
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center">
                            <Wand2 className="w-3 h-3 mr-1 text-purple-400" />
                            Design Goal
                        </label>
                        <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-800">
                            <button 
                                onClick={() => setDesignMode(DesignMode.NEW_CONCEPT)}
                                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center ${designMode === DesignMode.NEW_CONCEPT ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            >
                                <Sparkles size={12} className="mr-1.5" />
                                New Concept
                            </button>
                            <button 
                                onClick={() => setDesignMode(DesignMode.ENHANCE_EXISTING)}
                                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center ${designMode === DesignMode.ENHANCE_EXISTING ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            >
                                <Paintbrush size={12} className="mr-1.5" />
                                Enhance Existing
                            </button>
                        </div>
                     </div>
    
                     {/* Product Type Selector */}
                     <div className="flex flex-col">
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center">
                            <Package className="w-3 h-3 mr-1 text-blue-400" />
                            Product Type
                        </label>
                        <select
                            value={productType}
                            onChange={(e) => setProductType(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                        >
                            {PRODUCT_TYPES.map(type => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                     </div>
                  </div>
              )}
           </div>
        )}

        {/* Quick Actions (Before Upload) */}
        {stage === ProcessStage.IDLE && (
            <div className="flex justify-center mb-6 animate-fade-in delay-100">
                <button
                   onClick={() => setDesignMode(DesignMode.CLEAN_ONLY)}
                   className={`flex items-center px-4 py-2 rounded-full text-xs font-bold transition-all border ${designMode === DesignMode.CLEAN_ONLY ? 'bg-teal-900/30 text-teal-300 border-teal-500/50' : 'bg-slate-900 text-slate-500 border-slate-800 hover:border-slate-600'}`}
                >
                   <Eraser size={14} className="mr-1.5" />
                   Quick Tool: Remove Background & Ropes Only
                </button>
            </div>
        )}

        {stage === ProcessStage.IDLE ? (
          <div className="max-w-2xl mx-auto animate-fade-in delay-200">
            <FileUpload onFileSelect={processFile} />
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-6 bg-red-950/30 border border-red-900/50 text-red-200 p-4 rounded-xl flex items-center shadow-lg animate-fade-in">
                <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0 text-red-500" />
                <span className="text-sm font-medium">{error}</span>
                <button 
                    onClick={() => setStage(ProcessStage.IDLE)} 
                    className="ml-auto text-xs bg-red-900/50 hover:bg-red-800 px-3 py-1.5 rounded-lg transition-colors border border-red-800"
                >
                    Try Again
                </button>
              </div>
            )}

            <ResultsPanel
              originalImage={originalImage || ''}
              processedImage={processedImage}
              analysis={analysis}
              generatedRedesigns={generatedRedesigns}
              stage={stage}
              activeTab={activeTab}
              onImageClick={handleRedesignClick}
            />

            {stage === ProcessStage.COMPLETE && (
               <div className="mt-8 flex justify-center animate-fade-in">
                  <button
                    onClick={resetState}
                    className="flex items-center px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-full font-bold shadow-lg transition-all border border-slate-700 hover:border-indigo-500"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Start New Design
                  </button>
               </div>
            )}
          </>
        )}
      </main>

      <HistorySidebar
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onSelect={handleLoadHistory}
        onDelete={handleDeleteHistory}
      />

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveKeys}
      />

      {generatedRedesigns && selectedRedesignIndex !== null && (
        <RedesignDetailModal
          isOpen={isDetailModalOpen}
          onClose={() => setIsDetailModalOpen(false)}
          imageUrl={generatedRedesigns[selectedRedesignIndex]}
          onRemix={handleRemix}
          onRemoveBackground={handleRemoveBackground}
          onSplit={handleSplit}
          onGenerateMockup={handleGenerateMockup}
          onUpdateImage={handleUpdateRedesign}
          isRemixing={isRemixing}
          onUndo={() => handleUndoRedesign(selectedRedesignIndex!)}
          onRedo={() => handleRedoRedesign(selectedRedesignIndex!)}
          canUndo={(redesignHistory[selectedRedesignIndex!]?.length || 0) > 0}
          canRedo={(redoHistory[selectedRedesignIndex!]?.length || 0) > 0}
          isTShirtMode={activeTab === AppTab.TSHIRT}
        />
      )}
    </div>
  );
}

export default App;
