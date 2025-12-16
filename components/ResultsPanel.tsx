
import React from 'react';
import { Download, Wand2, Loader2, CheckCircle2, Sparkles, Image as ImageIcon, Settings2, ZoomIn, Shirt, Scissors } from 'lucide-react';
import { ProductAnalysis, ProcessStage, AppTab } from '../types';

interface ResultsPanelProps {
  originalImage: string;
  processedImage: string | null;
  analysis: ProductAnalysis | null;
  generatedRedesigns: string[] | null;
  stage: ProcessStage;
  activeTab: AppTab; // New prop
  onImageClick?: (index: number) => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  originalImage,
  processedImage,
  analysis,
  generatedRedesigns,
  stage,
  activeTab,
  onImageClick
}) => {

  const downloadImageAs2500px = (e: React.MouseEvent, dataUrl: string, filename: string, removeWhite: boolean = false) => {
    e.stopPropagation(); // Prevent opening the modal when just downloading
    const img = new Image();
    img.src = dataUrl;
    img.crossOrigin = "anonymous"; // Handle cross-origin if needed
    
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 2500;
        canvas.height = 2500;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Use high quality scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw image scaled to 2500x2500
        ctx.drawImage(img, 0, 0, 2500, 2500);

        // --- SMART REMOVAL (Transparency) ---
        // Used for T-Shirt Mode OR if explicitly requested (Cleaned Image)
        if (activeTab === AppTab.TSHIRT || removeWhite) {
            const imageData = ctx.getImageData(0, 0, 2500, 2500);
            const data = imageData.data;
            const threshold = 220; // Lowered from 240 to catch artifacts

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // If pixel is very light/white, make it transparent
                if (r > threshold && g > threshold && b > threshold) {
                    data[i + 3] = 0; // Alpha = 0
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        // ---------------------------------
        
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = filename.replace(/\.(jpg|jpeg)$/i, '.png'); // Ensure extension is png
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
  };

  const isLoading = stage !== ProcessStage.COMPLETE && stage !== ProcessStage.IDLE && stage !== ProcessStage.REVIEW;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Images */}
        <div className="space-y-6">
          {/* Image Comparison */}
          <div className={`grid ${activeTab === AppTab.TSHIRT ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
            {/* Original */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-slate-400 text-sm uppercase tracking-wider">Original</h3>
              </div>
              <div className="relative aspect-square bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
                <img src={originalImage} alt="Original" className="w-full h-full object-contain" />
              </div>
            </div>

            {/* Processed (Hidden for Tshirt mode) */}
            {activeTab !== AppTab.TSHIRT && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-indigo-400 text-sm uppercase tracking-wider flex items-center">
                    {stage === ProcessStage.CLEANING && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                    Cleaned
                  </h3>
                  {processedImage && (
                    <div className="flex space-x-1">
                        <button
                            onClick={(e) => downloadImageAs2500px(e, processedImage, 'cleaned-product-transparent.png', true)}
                            className="p-1 text-indigo-400 hover:bg-slate-800 rounded-md transition-colors"
                            title="Download Transparent PNG"
                        >
                            <Scissors size={16} />
                        </button>
                        <button
                            onClick={(e) => downloadImageAs2500px(e, processedImage, 'cleaned-product.jpg', false)}
                            className="p-1 text-slate-400 hover:bg-slate-800 rounded-md transition-colors"
                            title="Download JPG (White BG)"
                        >
                            <Download size={16} />
                        </button>
                    </div>
                  )}
                </div>
                {/* Dark checkerboard pattern for transparent images */}
                <div className="relative aspect-square bg-[linear-gradient(45deg,#1e293b_25%,transparent_25%,transparent_75%,#1e293b_75%,#1e293b),linear-gradient(45deg,#1e293b_25%,transparent_25%,transparent_75%,#1e293b_75%,#1e293b)] bg-[length:20px_20px] bg-[position:0_0,10px_10px] bg-slate-900 rounded-xl overflow-hidden border border-slate-700 shadow-sm group">
                  {processedImage ? (
                    <img src={processedImage} alt="Processed" className="w-full h-full object-contain p-4" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 p-4 text-center">
                      {stage === ProcessStage.CLEANING ? (
                        <>
                          <Loader2 className="w-8 h-8 animate-spin mb-2 text-indigo-500" />
                          <span className="text-xs">Removing background & ropes...</span>
                        </>
                      ) : (
                        <span className="text-xs">Waiting for processing...</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Status Stepper */}
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-sm">
            <div className="space-y-4">
              <div className={`flex items-center ${stage !== ProcessStage.UPLOADING ? 'text-green-400' : 'text-slate-500'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 mr-3 ${stage === ProcessStage.CLEANING ? 'border-indigo-500 text-indigo-500' : (stage !== ProcessStage.UPLOADING ? 'border-green-500 bg-green-500/10' : 'border-slate-700')}`}>
                  {stage !== ProcessStage.UPLOADING && stage !== ProcessStage.CLEANING ? <CheckCircle2 size={14} /> : '1'}
                </div>
                <span className="text-sm font-medium">Clean & Analyze Design</span>
              </div>
              
              <div className={`flex items-center ${[ProcessStage.REVIEW, ProcessStage.GENERATING, ProcessStage.COMPLETE].includes(stage) ? 'text-green-400' : 'text-slate-500'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 mr-3 ${stage === ProcessStage.ANALYZING ? 'border-indigo-500 text-indigo-500' : ([ProcessStage.REVIEW, ProcessStage.GENERATING, ProcessStage.COMPLETE].includes(stage) ? 'border-green-500 bg-green-500/10' : 'border-slate-700')}`}>
                  {[ProcessStage.REVIEW, ProcessStage.GENERATING, ProcessStage.COMPLETE].includes(stage) ? <CheckCircle2 size={14} /> : '2'}
                </div>
                <span className="text-sm font-medium">Extract Elements & Style</span>
              </div>

               <div className={`flex items-center ${[ProcessStage.GENERATING, ProcessStage.COMPLETE].includes(stage) ? 'text-green-400' : 'text-slate-500'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 mr-3 ${stage === ProcessStage.REVIEW ? 'border-amber-500 text-amber-500' : ([ProcessStage.GENERATING, ProcessStage.COMPLETE].includes(stage) ? 'border-green-500 bg-green-500/10' : 'border-slate-700')}`}>
                  {[ProcessStage.GENERATING, ProcessStage.COMPLETE].includes(stage) ? <CheckCircle2 size={14} /> : (stage === ProcessStage.REVIEW ? <Settings2 size={14} /> : '3')}
                </div>
                <span className="text-sm font-medium">Configuration</span>
              </div>

              <div className={`flex items-center ${stage === ProcessStage.COMPLETE ? 'text-green-400' : 'text-slate-500'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 mr-3 ${stage === ProcessStage.GENERATING ? 'border-indigo-500 text-indigo-500' : (stage === ProcessStage.COMPLETE ? 'border-green-500 bg-green-500/10' : 'border-slate-700')}`}>
                  {stage === ProcessStage.COMPLETE ? <CheckCircle2 size={14} /> : '4'}
                </div>
                <span className="text-sm font-medium">Generate {activeTab === AppTab.TSHIRT ? '3 T-Shirt Graphics' : '6 POD Designs'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Analysis */}
        <div className="flex flex-col h-full">
          <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-lg flex-grow overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-800 bg-slate-800/50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-200 flex items-center">
                <Wand2 className="w-4 h-4 mr-2 text-purple-400" />
                AI Analysis & Strategy
              </h3>
            </div>
            
            <div className="p-6 overflow-y-auto flex-grow space-y-6 max-h-[500px] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
              {!analysis && isLoading ? (
                <div className="space-y-4 animate-pulse">
                  <div className="h-4 bg-slate-800 rounded w-3/4"></div>
                  <div className="h-4 bg-slate-800 rounded w-1/2"></div>
                  <div className="h-24 bg-slate-800 rounded w-full"></div>
                </div>
              ) : analysis ? (
                <>
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Product Description</h4>
                    <p className="text-sm text-slate-300 leading-relaxed">{analysis.description}</p>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Design Critique</h4>
                    <div className="p-3 bg-amber-950/30 border border-amber-900/50 rounded-lg text-sm text-amber-200 leading-relaxed">
                      {analysis.designCritique}
                    </div>
                  </div>
                  
                   <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Detected Components</h4>
                    <div className="flex flex-wrap gap-2">
                      {analysis.detectedComponents?.map((comp, i) => (
                        <span key={i} className="px-2 py-1 bg-slate-800 text-slate-300 text-xs rounded border border-slate-700">
                          {comp}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center">
                      Auto-Generated Redesign Prompt
                      <span className="ml-2 px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded-full text-[10px] border border-purple-800">Optimized</span>
                    </h4>
                    <div className="p-4 bg-black/50 border border-slate-700 text-slate-300 rounded-lg text-sm font-mono leading-relaxed relative group">
                      {analysis.redesignPrompt}
                      <button 
                        onClick={() => navigator.clipboard.writeText(analysis.redesignPrompt)}
                        className="absolute top-2 right-2 p-1.5 bg-slate-700 hover:bg-slate-600 rounded opacity-0 group-hover:opacity-100 transition-opacity text-xs text-white"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 text-sm">
                  Analysis will appear here...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New Section: Generated Redesigns */}
      {(generatedRedesigns || stage === ProcessStage.GENERATING) && (
         <div className="space-y-4 border-t border-slate-800 pt-8">
            <h3 className="text-xl font-bold text-slate-200 flex items-center">
              {activeTab === AppTab.TSHIRT ? <Shirt className="w-5 h-5 mr-2 text-indigo-500" /> : <Sparkles className="w-5 h-5 mr-2 text-amber-500" />}
              {activeTab === AppTab.TSHIRT ? 'T-Shirt Design Options' : 'AI Generated Redesigns'}
              {stage === ProcessStage.GENERATING && <span className="ml-3 text-sm font-normal text-slate-400 flex items-center"><Loader2 className="w-3 h-3 mr-1 animate-spin"/> Generating {activeTab === AppTab.TSHIRT ? '3' : '6'} high-quality options...</span>}
            </h3>
            
            <div className={`grid grid-cols-1 ${activeTab === AppTab.TSHIRT ? 'md:grid-cols-3' : 'md:grid-cols-3'} gap-6`}>
              {stage === ProcessStage.GENERATING ? (
                 Array(activeTab === AppTab.TSHIRT ? 3 : 6).fill(0).map((_, i) => (
                    <div key={i} className="aspect-square bg-slate-900 rounded-xl animate-pulse flex items-center justify-center border border-slate-800">
                        <ImageIcon className="text-slate-700 w-8 h-8" />
                    </div>
                 ))
              ) : (
                 generatedRedesigns?.map((img, index) => (
                    <div 
                      key={index} 
                      onClick={() => onImageClick && onImageClick(index)}
                      className="group relative aspect-square bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-sm hover:shadow-xl hover:border-indigo-500 transition-all cursor-pointer"
                    >
                       {/* T-Shirt Mockup Overlay logic */}
                       {activeTab === AppTab.TSHIRT ? (
                          <div className="w-full h-full relative bg-slate-200">
                              {/* T-Shirt Base Image Placeholder */}
                              <div className="absolute inset-0 bg-[url('https://cdn.pixabay.com/photo/2016/11/23/06/57/isolated-t-shirt-1852114_1280.png')] bg-center bg-cover bg-no-repeat opacity-90"></div>
                              
                              {/* The generated design overlay */}
                              <div className="absolute inset-0 flex items-center justify-center p-16 top-[-20px]">
                                  <img 
                                    src={img} 
                                    alt={`T-Shirt Design ${index + 1}`} 
                                    className="max-w-full max-h-full object-contain mix-blend-multiply opacity-90" 
                                  />
                              </div>
                          </div>
                       ) : (
                          // Standard POD display
                          <img src={img} alt={`Redesign ${index + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                       )}

                       <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <div className="flex flex-col items-center space-y-3 transform translate-y-2 group-hover:translate-y-0 transition-all">
                            <span className="bg-slate-900/90 backdrop-blur text-white px-4 py-2 rounded-full font-bold text-sm flex items-center shadow-lg border border-slate-700">
                              <ZoomIn className="w-4 h-4 mr-2 text-indigo-400" />
                              View & Remix
                            </span>
                            <button 
                               onClick={(e) => downloadImageAs2500px(e, img, `design-option-2500px-${index + 1}.png`, activeTab === AppTab.TSHIRT)}
                               className="bg-indigo-600 backdrop-blur text-white px-4 py-2 rounded-full font-medium text-xs flex items-center hover:bg-indigo-700 transition-colors border border-indigo-500 shadow-lg"
                            >
                              <Download className="w-3 h-3 mr-2" />
                              Download PNG
                            </button>
                          </div>
                       </div>
                       <div className="absolute bottom-3 left-3 px-2 py-1 bg-black/70 backdrop-blur-sm rounded text-white text-xs font-medium border border-white/10">
                          Option {index + 1}
                       </div>
                    </div>
                 ))
              )}
            </div>
         </div>
      )}
    </div>
  );
};
