
import React, { useState, useEffect, useRef } from 'react';
import { X, Download, RefreshCw, Palette, Sparkles, Wand2, MessageSquare, Link2, Eraser, Scissors, Image as ImageIcon, RotateCcw, RotateCw, Shirt, Zap, ZoomIn, ZoomOut, Move, Hand, Save, MousePointer2, MonitorPlay, Layers, Undo2, Redo2 } from 'lucide-react';
import { ROPE_OPTIONS } from '../types';
import { generateSmartMockupBatch } from '../services/geminiService';

interface RedesignDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onRemix: (instruction: string) => Promise<void>;
  onRemoveBackground: () => Promise<void>;
  onSplit: () => Promise<string[]>;
  onGenerateMockup: (img: string) => Promise<string>;
  onUpdateImage?: (newImage: string) => void;
  isRemixing: boolean;
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  isTShirtMode?: boolean; 
}

const COLOR_PALETTE = [
  { name: 'Classic Red', hex: '#ef4444' },
  { name: 'Forest Green', hex: '#15803d' },
  { name: 'Royal Gold', hex: '#fbbf24' },
  { name: 'Ice Blue', hex: '#3b82f6' },
  { name: 'Midnight', hex: '#1e293b' },
  { name: 'Pure White', hex: '#ffffff' },
  { name: 'Lavender', hex: '#a855f7' },
  { name: 'Rose Gold', hex: '#f43f5e' },
];

// --- SUB-COMPONENT: MANUAL MASK EDITOR ---
const ManualMaskEditor: React.FC<{ 
    src: string; 
    onSave: (newImage: string) => void; 
    onCancel: () => void; 
}> = ({ src, onSave, onCancel }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [brushSize, setBrushSize] = useState(30);
    
    // Tools
    const [tool, setTool] = useState<'eraser' | 'pan' | 'magic'>('magic');
    const [tolerance, setTolerance] = useState(40); 
    const [isPolishing, setIsPolishing] = useState(false);
    
    // Background Color
    const [canvasBg, setCanvasBg] = useState<string>('transparent');

    // History for Undo/Redo within the Editor
    const [history, setHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // Cursor Visualization
    const [cursorPos, setCursorPos] = useState<{x: number, y: number} | null>(null);

    // Initial Load
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = src;
        img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;
            ctx.drawImage(img, 0, 0);

            // Initialize History
            const initialData = canvas.toDataURL();
            setHistory([initialData]);
            setHistoryIndex(0);

            // Center View
            if (containerRef.current) {
                const cw = containerRef.current.clientWidth;
                const ch = containerRef.current.clientHeight;
                const initialScale = Math.min(cw / img.width, ch / img.height) * 0.9;
                setScale(initialScale);
            }
        };
    }, [src]);

    const saveToHistory = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const newData = canvas.toDataURL();
        
        // If we are in the middle of history and save, discard future states
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(newData);
        
        // Limit history size to prevent memory issues (e.g., 20 steps)
        if (newHistory.length > 20) {
            newHistory.shift();
        }

        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    };

    const handleUndo = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            restoreCanvas(history[newIndex]);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            restoreCanvas(history[newIndex]);
        }
    };

    const restoreCanvas = (dataUrl: string) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.src = dataUrl;
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
    };

    const getMousePos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        
        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }

        // Calculate position relative to the canvas element (scaled)
        const x = Math.floor((clientX - rect.left) / scale);
        const y = Math.floor((clientY - rect.top) / scale);
        
        return { x, y, clientX, clientY };
    };

    // --- OPERATIONS ---
    const handleAutoPolish = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        setIsPolishing(true);

        setTimeout(() => {
            const w = canvas.width;
            const h = canvas.height;
            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;
            
            const newAlpha = new Uint8ClampedArray(w * h);
            const originalAlpha = new Uint8ClampedArray(w * h);

            // 1. Erode White Halos
            for (let i = 0; i < w * h; i++) {
                originalAlpha[i] = data[i * 4 + 3];
                newAlpha[i] = data[i * 4 + 3]; 
            }

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x);
                    const pixelIdx = idx * 4;
                    const a = originalAlpha[idx];
                    if (a === 0) continue;

                    let isEdge = false;
                    const neighbors = [((y) * w + (x - 1)), ((y) * w + (x + 1)), ((y - 1) * w + x), ((y + 1) * w + x)];
                    for (const nIdx of neighbors) {
                        if (nIdx >= 0 && nIdx < w * h && originalAlpha[nIdx] < 50) {
                            isEdge = true; break;
                        }
                    }

                    if (isEdge) {
                        const r = data[pixelIdx];
                        const g = data[pixelIdx + 1];
                        const b = data[pixelIdx + 2];
                        if (r > 200 && g > 200 && b > 200) newAlpha[idx] = 0; 
                        else newAlpha[idx] = 0; // Aggressive smooth
                    }
                }
            }
            
            // 2. Blur Alpha
            const smoothedAlpha = new Uint8ClampedArray(w * h);
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    const idx = y * w + x;
                    if (newAlpha[idx] > 0 && newAlpha[idx] < 255 || 
                       (newAlpha[idx] === 255 && (newAlpha[idx-1] < 255 || newAlpha[idx+1] < 255 || newAlpha[idx-w] < 255 || newAlpha[idx+w] < 255))) {
                        let sum = 0;
                        sum += newAlpha[idx - w - 1] + newAlpha[idx - w] + newAlpha[idx - w + 1];
                        sum += newAlpha[idx - 1]     + newAlpha[idx]     + newAlpha[idx + 1];
                        sum += newAlpha[idx + w - 1] + newAlpha[idx + w] + newAlpha[idx + w + 1];
                        smoothedAlpha[idx] = Math.floor(sum / 9);
                    } else {
                        smoothedAlpha[idx] = newAlpha[idx];
                    }
                }
            }

            for (let i = 0; i < w * h; i++) data[i * 4 + 3] = smoothedAlpha[i];
            ctx.putImageData(imageData, 0, 0);
            setIsPolishing(false);
            
            saveToHistory(); // Save after polish
        }, 100);
    };

    const performFloodFill = (startX: number, startY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const getIdx = (x: number, y: number) => (y * w + x) * 4;
        const startIdx = getIdx(startX, startY);
        const startR = data[startIdx], startG = data[startIdx + 1], startB = data[startIdx + 2], startA = data[startIdx + 3];

        if (startA === 0) return;

        const visited = new Uint8Array(w * h);
        const stack = [startX, startY];

        while (stack.length > 0) {
            const y = stack.pop()!;
            const x = stack.pop()!;
            const idx = y * w + x;
            if (visited[idx]) continue;
            visited[idx] = 1;

            const pixelIdx = idx * 4;
            const r = data[pixelIdx], g = data[pixelIdx + 1], b = data[pixelIdx + 2], a = data[pixelIdx + 3];
            if (a === 0) continue;

            const diff = Math.abs(r - startR) + Math.abs(g - startG) + Math.abs(b - startB);
            if (diff <= tolerance) {
                data[pixelIdx + 3] = 0;
                if (x > 0) stack.push(x - 1, y);
                if (x < w - 1) stack.push(x + 1, y);
                if (y > 0) stack.push(x, y - 1);
                if (y < h - 1) stack.push(x, y + 1);
            }
        }
        ctx.putImageData(imageData, 0, 0);
        saveToHistory(); // Save after magic wand
    };

    const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
        if (tool === 'pan') {
            setIsDragging(true);
            let clientX, clientY;
            if ('touches' in e) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = (e as React.MouseEvent).clientX;
                clientY = (e as React.MouseEvent).clientY;
            }
            setDragStart({ x: clientX - offset.x, y: clientY - offset.y });
        } else if (tool === 'magic') {
            const { x, y } = getMousePos(e);
            requestAnimationFrame(() => performFloodFill(x, y));
        } else {
            setIsDragging(true);
            erase(e);
        }
    };

    const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
        const { clientX, clientY } = getMousePos(e);
        
        // Update custom cursor position
        setCursorPos({ x: clientX, y: clientY });

        if (!isDragging) return;

        if (tool === 'pan') {
            setOffset({
                x: clientX - dragStart.x,
                y: clientY - dragStart.y
            });
        } else if (tool === 'eraser') {
            erase(e);
        }
    };

    const handleMouseUp = () => {
        if (isDragging && tool === 'eraser') {
            saveToHistory(); // Save stroke end
        }
        setIsDragging(false);
    };

    const handleMouseLeave = () => {
        setIsDragging(false);
        setCursorPos(null); // Hide cursor when leaving
    };

    const erase = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { x, y } = getMousePos(e);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const newScale = Math.min(Math.max(0.1, scale - e.deltaY * 0.001), 5);
        setScale(newScale);
    };

    const handleSave = () => {
        const canvas = canvasRef.current;
        if (canvas) {
            onSave(canvas.toDataURL('image/png'));
        }
    };

    return (
        <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col">
            {/* Toolbar */}
            <div className="h-14 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4 shadow-md z-10 relative">
                <div className="flex items-center space-x-3 overflow-x-auto no-scrollbar">
                    <h3 className="text-sm font-bold text-white flex items-center whitespace-nowrap mr-2">
                        <Scissors className="w-4 h-4 mr-2 text-indigo-400" />
                        Manual Cleanup
                    </h3>
                    
                    <div className="flex items-center space-x-1 bg-slate-900 rounded-lg p-1 border border-slate-700">
                         <button 
                            onClick={() => setTool('magic')}
                            className={`p-2 rounded ${tool === 'magic' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/50' : 'text-slate-400 hover:text-white'}`}
                            title="Magic Wand (Auto Remove Area)"
                        >
                            <Wand2 size={16} />
                        </button>
                        <button 
                            onClick={() => setTool('eraser')}
                            className={`p-2 rounded ${tool === 'eraser' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/50' : 'text-slate-400 hover:text-white'}`}
                            title="Eraser Brush"
                        >
                            <Eraser size={16} />
                        </button>
                        <button 
                            onClick={() => setTool('pan')}
                            className={`p-2 rounded ${tool === 'pan' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/50' : 'text-slate-400 hover:text-white'}`}
                            title="Pan/Move"
                        >
                            <Hand size={16} />
                        </button>
                    </div>

                    {/* Undo / Redo Controls */}
                     <div className="flex items-center space-x-1 bg-slate-900 rounded-lg p-1 border border-slate-700 ml-2">
                        <button 
                            onClick={handleUndo}
                            disabled={historyIndex <= 0}
                            className="p-2 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800"
                            title="Undo (Quay lại)"
                        >
                            <Undo2 size={16} />
                        </button>
                        <button 
                            onClick={handleRedo}
                            disabled={historyIndex >= history.length - 1}
                            className="p-2 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800"
                            title="Redo (Đi tới)"
                        >
                            <Redo2 size={16} />
                        </button>
                    </div>

                    {/* Tool Settings */}
                    {tool === 'eraser' && (
                        <div className="flex items-center space-x-2 animate-fade-in mx-2">
                            <span className="text-xs text-slate-400 whitespace-nowrap">Size:</span>
                            <input 
                                type="range" 
                                min="5" 
                                max="200" 
                                value={brushSize} 
                                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                className="w-20 accent-indigo-500 h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    )}
                    {tool === 'magic' && (
                        <div className="flex items-center space-x-2 animate-fade-in mx-2">
                            <span className="text-xs text-slate-400 whitespace-nowrap">Tol:</span>
                            <input 
                                type="range" 
                                min="0" 
                                max="100" 
                                value={tolerance} 
                                onChange={(e) => setTolerance(parseInt(e.target.value))}
                                className="w-20 accent-indigo-500 h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    )}
                    
                    <button
                        onClick={handleAutoPolish}
                        disabled={isPolishing}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-amber-900/30 text-amber-400 border border-amber-800 rounded-lg hover:bg-amber-900/50 hover:text-amber-200 transition-colors shadow-sm ml-2 whitespace-nowrap"
                        title="Auto Polish Edges"
                    >
                         {isPolishing ? <RefreshCw size={14} className="animate-spin" /> : <Layers size={14} />}
                         <span className="text-xs font-bold hidden sm:inline">Polish</span>
                    </button>

                    {/* BG Selector */}
                    <div className="flex items-center space-x-1 ml-2 border-l border-slate-700 pl-3">
                        <button onClick={() => setCanvasBg('transparent')} className={`w-4 h-4 rounded border ${canvasBg === 'transparent' ? 'border-indigo-500' : 'border-slate-600'} bg-[url('https://t3.ftcdn.net/jpg/03/35/35/60/360_F_335356066_6yZ1p5F3V1s0v3t5q1s1.jpg')] bg-cover`}/>
                        <button onClick={() => setCanvasBg('#000000')} className={`w-4 h-4 rounded border ${canvasBg === '#000000' ? 'border-indigo-500' : 'border-slate-600'} bg-black`}/>
                        <button onClick={() => setCanvasBg('#ef4444')} className={`w-4 h-4 rounded border ${canvasBg === '#ef4444' ? 'border-indigo-500' : 'border-slate-600'} bg-red-500`}/>
                    </div>

                </div>
                
                <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                        <button onClick={() => setScale(s => Math.max(0.1, s - 0.1))} className="text-slate-400 hover:text-white"><ZoomOut size={16} /></button>
                        <span className="text-xs text-slate-400 w-8 text-center">{Math.round(scale * 100)}%</span>
                        <button onClick={() => setScale(s => Math.min(5, s + 0.1))} className="text-slate-400 hover:text-white"><ZoomIn size={16} /></button>
                    </div>

                    <div className="flex items-center space-x-2">
                        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700 rounded-lg">Cancel</button>
                        <button onClick={handleSave} className="px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-500 rounded-lg flex items-center shadow">
                            <Save size={14} className="mr-1" /> Save
                        </button>
                    </div>
                </div>
            </div>

            {/* Canvas Area */}
            <div 
                ref={containerRef}
                className="flex-1 overflow-hidden relative cursor-crosshair transition-colors duration-200"
                style={{
                    backgroundColor: canvasBg === 'transparent' ? 'transparent' : canvasBg,
                    backgroundImage: canvasBg === 'transparent' ? "url('https://t3.ftcdn.net/jpg/03/35/35/60/360_F_335356066_6yZ1p5F3V1s0v3t5q1s1.jpg')" : 'none',
                    backgroundRepeat: 'repeat'
                }}
                onWheel={handleWheel}
            >
                <div 
                    className="w-full h-full flex items-center justify-center transition-transform duration-75 ease-linear will-change-transform"
                    style={{ 
                        // Hide default cursor only when using eraser on canvas
                        cursor: tool === 'pan' ? (isDragging ? 'grabbing' : 'grab') : (tool === 'eraser' ? 'none' : 'crosshair')
                    }}
                >
                     <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseLeave}
                        onTouchStart={handleMouseDown}
                        onTouchMove={handleMouseMove}
                        onTouchEnd={handleMouseUp}
                        style={{
                            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                            boxShadow: '0 0 20px rgba(0,0,0,0.5)',
                            transformOrigin: 'center center' 
                        }}
                    />
                </div>

                {/* Custom Eraser Cursor */}
                {tool === 'eraser' && cursorPos && (
                    <div 
                        className="pointer-events-none fixed rounded-full border border-white bg-white/20 shadow-sm z-50 mix-blend-difference"
                        style={{
                            left: cursorPos.x,
                            top: cursorPos.y,
                            width: brushSize * scale,
                            height: brushSize * scale,
                            transform: 'translate(-50%, -50%)',
                            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)' // Outer black ring for visibility on white
                        }}
                    />
                )}
            </div>
            
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-xs text-slate-300 pointer-events-none">
                {tool === 'magic' ? 'Click white spots to remove' : (tool === 'eraser' ? 'Click or Drag to erase' : 'Drag to move view')}
            </div>
        </div>
    );
};


export const RedesignDetailModal: React.FC<RedesignDetailModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  onRemix,
  onRemoveBackground,
  onSplit,
  onGenerateMockup,
  onUpdateImage,
  isRemixing,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  isTShirtMode
}) => {
  const [activeTab, setActiveTab] = useState<'colors' | 'ropes' | 'split' | 'mockup'>('colors');
  const [customPrompt, setCustomPrompt] = useState('');
  
  // Split State
  const [splitImages, setSplitImages] = useState<string[]>([]);
  const [isSplitting, setIsSplitting] = useState(false);

  // Mockup Preview State
  const [mockupPreview, setMockupPreview] = useState<{img: string, index: number} | null>(null);
  const [isGeneratingMockup, setIsGeneratingMockup] = useState(false);
  
  // Smart Mockup Batch State
  const [smartMockupImages, setSmartMockupImages] = useState<string[]>([]);
  const [isGeneratingSmart, setIsGeneratingSmart] = useState(false);
  const [selectedMockupView, setSelectedMockupView] = useState<string | null>(null);

  // Manual Editor State
  const [isEditingManual, setIsEditingManual] = useState(false);

  // Helper to switch tabs and clear view
  const handleTabChange = (tab: 'colors' | 'ropes' | 'split' | 'mockup') => {
      setActiveTab(tab);
      // Clear the mockup view so the main design is shown when switching away from mockup tab
      setSelectedMockupView(null);
      setMockupPreview(null);
  };

  // Wrapper to clean state when remixing
  const handleRemixWrapper = (instruction: string) => {
      // Clear Mockups when user triggers a remix (changes the design)
      setSmartMockupImages([]); 
      setSelectedMockupView(null);
      onRemix(instruction);
  };

  // 2500x2500 Upscale Logic
  const handleDownload = (url: string, filename: string, forceTransparent: boolean = false) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;

    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 2500;
        canvas.height = 2500;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        // Draw Image Scaled to 2500x2500
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, 2500, 2500);

        if (forceTransparent) {
             const imageData = ctx.getImageData(0, 0, 2500, 2500);
             const data = imageData.data;
             const width = 2500;
             const height = 2500;
             const tolerance = 20;
             const visited = new Uint8Array(width * height);
             const bgR = data[0], bgG = data[1], bgB = data[2];

             const stack = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
             while (stack.length > 0) {
                 const pos = stack.pop();
                 if (!pos) continue;
                 const x = pos[0], y = pos[1];
                 if (x < 0 || x >= width || y < 0 || y >= height) continue;
                 const idx = (y * width + x);
                 if (visited[idx]) continue;
                 visited[idx] = 1;
                 const offset = idx * 4;
                 const r = data[offset], g = data[offset + 1], b = data[offset + 2];
                 const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
                 const isWhite = r > 230 && g > 230 && b > 230;
                 if (diff < tolerance * 3 || isWhite) {
                     data[offset + 3] = 0;
                     stack.push([x + 1, y]); stack.push([x - 1, y]); stack.push([x, y + 1]); stack.push([x, y - 1]);
                 }
             }
             ctx.putImageData(imageData, 0, 0);
        }

        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        if (!filename.toLowerCase().endsWith('.png')) {
            filename = filename.replace(/\.[^/.]+$/, "") + ".png";
        }
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
  };

  const handleCustomSubmit = () => {
      if (customPrompt.trim()) {
          handleRemixWrapper(customPrompt);
      }
  };

  const handleSplitClick = async () => {
    setIsSplitting(true);
    setSplitImages([]);
    setMockupPreview(null);
    try {
        const images = await onSplit();
        setSplitImages(images);
    } catch (error) {
        console.error("Split failed", error);
    } finally {
        setIsSplitting(false);
    }
  };

  const handleSmartMockupBatch = async () => {
      setIsGeneratingSmart(true);
      setSmartMockupImages([]);
      setSelectedMockupView(null);
      try {
          const mockups = await generateSmartMockupBatch(imageUrl);
          setSmartMockupImages(mockups);
      } catch (e) {
          console.error("Smart mockup batch failed", e);
      } finally {
          setIsGeneratingSmart(false);
      }
  };

  const handleCreateMockup = async (img: string, index: number) => {
     setIsGeneratingMockup(true);
     try {
         const mockup = await onGenerateMockup(img);
         setMockupPreview({ img: mockup, index });
     } catch (error) {
         console.error("Mockup failed", error);
         alert("Failed to generate mockup.");
     } finally {
         setIsGeneratingMockup(false);
     }
  };

  const handleManualSave = (newImage: string) => {
      if (selectedMockupView) {
          // If editing a mockup, replace it in the array
          const index = smartMockupImages.indexOf(selectedMockupView);
          if (index !== -1) {
              const newArr = [...smartMockupImages];
              newArr[index] = newImage;
              setSmartMockupImages(newArr);
          }
          setSelectedMockupView(newImage);
      } else {
          // If editing the main image
          onUpdateImage?.(newImage);
      }
      setIsEditingManual(false);
  };

  if (!isOpen) return null;

  const currentMainImage = selectedMockupView || (mockupPreview ? mockupPreview.img : imageUrl);
  const isViewingMockup = !!selectedMockupView || !!mockupPreview;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/90 backdrop-blur-md transition-opacity" onClick={onClose} />
      
      {/* MANUAL EDITOR OVERLAY */}
      {isEditingManual && (
          <ManualMaskEditor 
             src={currentMainImage} 
             onSave={handleManualSave} 
             onCancel={() => setIsEditingManual(false)} 
          />
      )}

      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-fade-in border border-slate-800">
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900">
            <h3 className="text-lg font-bold text-slate-200 flex items-center">
              <Wand2 className="w-5 h-5 mr-2 text-indigo-500" />
              Design Detail & Remix
            </h3>
            <div className="flex items-center space-x-2">
              {onUndo && (
                  <button
                    onClick={onUndo}
                    disabled={!canUndo || isRemixing}
                    className="px-2 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 flex items-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Undo"
                  >
                      <RotateCcw size={16} />
                  </button>
              )}
              {onRedo && (
                  <button
                    onClick={onRedo}
                    disabled={!canRedo || isRemixing}
                    className="px-2 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 flex items-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Redo"
                  >
                      <RotateCw size={16} />
                  </button>
              )}

              {/* T-Shirt Mode Specific Buttons (Or POD Mode Buttons) */}
              {!isTShirtMode && (
                  <>
                    <button 
                        onClick={onRemoveBackground}
                        disabled={isRemixing}
                        className="hidden md:flex px-4 py-2 bg-indigo-950/30 border border-indigo-900/50 text-indigo-400 rounded-lg text-sm font-medium hover:bg-indigo-900/50 items-center transition-colors disabled:opacity-50"
                        title="Isolate product on white background"
                    >
                        <Eraser size={16} className="mr-2" />
                        Remove BG (AI)
                    </button>
                    
                    <button 
                        onClick={() => handleDownload(imageUrl, `transparent-design-${Date.now()}.png`, true)}
                        className="px-4 py-2 bg-teal-900/30 border border-teal-800 text-teal-300 rounded-lg text-sm font-medium hover:bg-teal-900/50 flex items-center shadow-lg shadow-teal-900/10"
                        title="Download PNG with Transparent Background (Preserve Whites) - 2500x2500"
                    >
                        <Scissors size={16} className="mr-2" />
                        Transparent (2.5K)
                    </button>

                    <button 
                        onClick={() => handleDownload(imageUrl, `design-variation-${Date.now()}.png`, false)}
                        className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 flex items-center"
                    >
                        <Download size={16} className="mr-2" />
                        JPG (2.5K)
                    </button>
                  </>
              )}

              {/* Close Button */}
              <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex flex-col lg:flex-row h-full overflow-hidden">
            
            {/* Left: Main Image */}
            <div className="w-full lg:w-2/3 bg-slate-950/50 relative flex items-center justify-center p-8 overflow-hidden group/main">
              <div className="relative w-full h-full flex items-center justify-center">
                
                {/* Checkered background only if viewing transparent design */}
                {!isViewingMockup && (
                    <div className="absolute inset-4 rounded-lg z-0 bg-[linear-gradient(45deg,#1e293b_25%,transparent_25%,transparent_75%,#1e293b_75%,#1e293b),linear-gradient(45deg,#1e293b_25%,transparent_25%,transparent_75%,#1e293b_75%,#1e293b)] bg-[length:20px_20px] bg-[position:0_0,10px_10px] opacity-30"></div>
                )}
                
                {/* MAIN IMAGE DISPLAY */}
                <img 
                    src={currentMainImage} 
                    alt="Detail View" 
                    className="max-w-full max-h-full object-contain shadow-2xl rounded-lg z-10 relative" 
                />
                
                {/* Manual Edit Button Overlay */}
                <div className="absolute top-6 right-6 z-30 opacity-0 group-hover/main:opacity-100 transition-opacity">
                     <button
                        onClick={() => setIsEditingManual(true)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center text-xs font-bold border border-indigo-400"
                     >
                        <MousePointer2 size={14} className="mr-2" />
                        Manual Cleanup / Edit
                     </button>
                </div>

                {/* Download Actions for T-Shirt Mode */}
                {isTShirtMode && (
                     <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 z-30">
                        {isViewingMockup ? (
                             <>
                                <button 
                                    onClick={() => handleDownload(currentMainImage, `mockup-${Date.now()}.png`, false)}
                                    className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2 rounded-full font-bold shadow-lg transition-all flex items-center"
                                >
                                    <Download size={16} className="mr-2" />
                                    Download Mockup (2.5K)
                                </button>
                                <button
                                    onClick={() => setSelectedMockupView(null)}
                                    className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-full font-medium shadow-lg transition-all border border-slate-700"
                                >
                                    Close View
                                </button>
                             </>
                        ) : (
                            <button 
                                onClick={() => handleDownload(imageUrl, `design-transparent-${Date.now()}.png`, true)}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-full font-bold shadow-lg transition-all flex items-center"
                                title="Tải thiết kế hiện tại (đã Remix) dưới dạng PNG không nền"
                            >
                                <Scissors size={16} className="mr-2" />
                                Download Design (2.5K PNG)
                            </button>
                        )}
                     </div>
                )}

                {(isRemixing || isGeneratingMockup || isGeneratingSmart) && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg z-20">
                    <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                    <span className="font-bold text-indigo-300 bg-slate-800 px-4 py-2 rounded-full shadow-lg border border-slate-700">
                      {isGeneratingSmart ? 'Generating 6 Mockups...' : (isGeneratingMockup ? 'Generating Mockup...' : 'Processing Remix...')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Controls */}
            <div className="w-full lg:w-1/3 bg-slate-900 border-l border-slate-800 flex flex-col h-full">
              
              {/* Custom Prompt Area */}
              {activeTab !== 'split' && activeTab !== 'mockup' && (
                <div className="p-6 pb-4 border-b border-slate-800">
                    <div className="flex items-center mb-2">
                        <MessageSquare size={16} className="text-indigo-500 mr-2" />
                        <h4 className="text-sm font-bold text-slate-300">Custom Instructions (Tùy chỉnh)</h4>
                    </div>
                    <div className="relative">
                        <textarea
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            placeholder="Nhập yêu cầu chỉnh sửa... (VD: đổi màu chữ viết thành màu đen, thêm tuyết rơi)"
                            className="w-full p-3 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none placeholder:text-slate-600"
                            rows={3}
                            disabled={isRemixing}
                        />
                        <button 
                            onClick={handleCustomSubmit}
                            disabled={!customPrompt.trim() || isRemixing}
                            className="absolute bottom-2 right-2 p-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Send Request"
                        >
                            <Sparkles size={14} />
                        </button>
                    </div>
                </div>
              )}

              {/* Tabs */}
              <div className="flex border-b border-slate-800">
                <button 
                  onClick={() => handleTabChange('colors')}
                  className={`flex-1 py-3 text-xs sm:text-sm font-semibold flex items-center justify-center ${activeTab === 'colors' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-950/20' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                >
                  <Palette size={14} className="mr-1.5" />
                  Colors
                </button>
                
                {!isTShirtMode && (
                     <button 
                      onClick={() => handleTabChange('ropes')}
                      className={`flex-1 py-3 text-xs sm:text-sm font-semibold flex items-center justify-center ${activeTab === 'ropes' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-950/20' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                    >
                      <Link2 size={14} className="mr-1.5" />
                      Ropes
                    </button>
                )}

                {isTShirtMode && (
                    <button 
                    onClick={() => handleTabChange('mockup')}
                    className={`flex-1 py-3 text-xs sm:text-sm font-semibold flex items-center justify-center ${activeTab === 'mockup' ? 'text-purple-400 border-b-2 border-purple-500 bg-purple-950/20' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                    >
                    <Shirt size={14} className="mr-1.5" />
                    Mockup
                    </button>
                )}
                
                {!isTShirtMode && (
                    <button 
                      onClick={() => handleTabChange('split')}
                      className={`flex-1 py-3 text-xs sm:text-sm font-semibold flex items-center justify-center ${activeTab === 'split' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-950/20' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                    >
                      <Scissors size={14} className="mr-1.5" />
                      Split
                    </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin scrollbar-thumb-slate-700">
                
                {activeTab === 'colors' && (
                  <div className="space-y-6 animate-fade-in">
                    <div>
                      <h4 className="text-sm font-bold text-slate-300 mb-4">Change Dominant Color</h4>
                      <div className="grid grid-cols-2 gap-3">
                        {COLOR_PALETTE.map((color) => (
                          <button
                            key={color.hex}
                            onClick={() => handleRemixWrapper(`Change the main color theme of this product to ${color.name} (${color.hex}). Keep the design style exactly the same.`)}
                            disabled={isRemixing}
                            className="flex items-center p-2 rounded-lg border border-slate-700 bg-slate-800 hover:border-indigo-500 hover:bg-slate-700 transition-all group text-left"
                          >
                            <div 
                              className="w-8 h-8 rounded-full shadow-sm mr-3 border border-slate-600" 
                              style={{ backgroundColor: color.hex }} 
                            />
                            <span className="text-sm font-medium text-slate-400 group-hover:text-white">
                              {color.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'ropes' && !isTShirtMode && (
                   <div className="space-y-6 animate-fade-in">
                     <div>
                       <h4 className="text-sm font-bold text-slate-300 mb-4">Add Hanging Rope</h4>
                       <div className="space-y-3">
                          {ROPE_OPTIONS.map((rope) => (
                            <button
                                key={rope.id}
                                onClick={() => handleRemixWrapper(`Add a hanging loop to the top of the ornament made of ${rope.name}. Make it look realistic.`)}
                                disabled={isRemixing}
                                className="w-full flex items-center p-3 rounded-lg border border-slate-700 bg-slate-800 hover:border-indigo-500 hover:bg-slate-700 transition-all group text-left"
                            >
                                <div 
                                    className="w-10 h-10 rounded-full border border-slate-600 flex-shrink-0 mr-3 shadow-sm"
                                    style={{ background: rope.color }}
                                />
                                <div>
                                    <span className="block text-sm font-medium text-slate-300 group-hover:text-indigo-300">
                                        {rope.name}
                                    </span>
                                    <span className="text-xs text-slate-500">
                                        Apply {rope.texture} texture
                                    </span>
                                </div>
                            </button>
                          ))}
                       </div>
                     </div>
                   </div>
                )}

                {activeTab === 'mockup' && isTShirtMode && (
                   <div className="space-y-6 animate-fade-in">
                       <div className="bg-purple-900/20 border border-purple-900/50 rounded-xl p-4 mb-4">
                           <h4 className="font-bold text-purple-400 mb-2 flex items-center">
                               <Shirt size={18} className="mr-2" />
                               Smart Mockup Studio
                           </h4>
                           
                           <button
                                onClick={handleSmartMockupBatch}
                                disabled={isGeneratingSmart}
                                className="w-full py-3 mb-4 bg-gradient-to-r from-pink-600 to-purple-600 text-white rounded-lg font-bold shadow-lg hover:shadow-purple-500/25 transition-all flex items-center justify-center border border-purple-500/30 group relative overflow-hidden"
                            >
                                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                                <Zap className="w-4 h-4 mr-2 text-yellow-300 fill-yellow-300" />
                                {isGeneratingSmart ? 'Generating 6 Mockups...' : 'Generate 6 Smart Mockups'}
                           </button>

                           <p className="text-xs text-purple-200 leading-relaxed mb-4">
                               AI will generate 6 photorealistic mockups with different models, angles, and lighting.
                           </p>

                           {/* 6 Grid Result */}
                           {smartMockupImages.length > 0 && (
                               <div className="grid grid-cols-2 gap-3 animate-fade-in">
                                   {smartMockupImages.map((img, idx) => (
                                       <button
                                           key={idx}
                                           onClick={() => setSelectedMockupView(img)}
                                           className={`relative group overflow-hidden rounded-xl border-2 transition-all aspect-square bg-slate-800 ${selectedMockupView === img ? 'border-purple-500 ring-2 ring-purple-500/50' : 'border-slate-700 hover:border-purple-500/50'}`}
                                       >
                                           <img src={img} alt={`Mockup ${idx+1}`} className="w-full h-full object-cover" />
                                           <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                               <ZoomIn className="text-white w-6 h-6 drop-shadow-md" />
                                           </div>
                                       </button>
                                   ))}
                               </div>
                           )}
                           
                           {smartMockupImages.length === 0 && !isGeneratingSmart && (
                                <div className="text-center py-8 border-2 border-dashed border-slate-800 rounded-xl text-slate-600">
                                    <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                    <span className="text-xs">No mockups generated yet.</span>
                                </div>
                           )}
                       </div>
                   </div>
                )}
                
                {activeTab === 'split' && !isTShirtMode && (
                  <div className="space-y-6 animate-fade-in">
                      {/* Main Split Controls */}
                      {!mockupPreview && (
                         <>
                             <div className="bg-indigo-950/20 border border-indigo-900/50 rounded-xl p-4">
                                <h4 className="font-bold text-indigo-400 mb-2 flex items-center">
                                    <Scissors size={18} className="mr-2" />
                                    Character Separation
                                </h4>
                                <p className="text-sm text-indigo-300 mb-4">
                                    Auto-detect and isolate individual characters/figures from the image onto white backgrounds.
                                </p>
                                
                                <button
                                    onClick={handleSplitClick}
                                    disabled={isSplitting}
                                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg shadow-indigo-900/20 transition-all flex items-center justify-center disabled:opacity-50"
                                >
                                    {isSplitting ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                            Detecting & Splitting...
                                        </>
                                    ) : (
                                        <>
                                            <Scissors className="w-4 h-4 mr-2" />
                                            Auto Detect & Split
                                        </>
                                    )}
                                </button>
                            </div>

                            {splitImages.length > 0 && (
                                <div className="space-y-4">
                                    <h4 className="font-bold text-slate-300">Result ({splitImages.length})</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        {splitImages.map((img, idx) => (
                                            <div key={idx} className="bg-slate-800 border border-slate-700 rounded-lg p-2 relative group">
                                                <div className="aspect-square bg-[linear-gradient(45deg,#1e293b_25%,transparent_25%,transparent_75%,#1e293b_75%,#1e293b),linear-gradient(45deg,#1e293b_25%,transparent_25%,transparent_75%,#1e293b_75%,#1e293b)] bg-[length:20px_20px] bg-[position:0_0,10px_10px] bg-slate-900 overflow-hidden rounded mb-2">
                                                    <img src={img} alt={`Split ${idx}`} className="w-full h-full object-contain" />
                                                </div>
                                                <div className="grid grid-cols-1 gap-2">
                                                    <button
                                                        onClick={() => handleCreateMockup(img, idx)}
                                                        className="w-full py-2 bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:from-amber-500 hover:to-orange-500 text-xs font-bold rounded shadow-sm hover:shadow flex items-center justify-center transition-all"
                                                        disabled={isGeneratingMockup}
                                                    >
                                                        <MonitorPlay size={12} className="mr-1" /> Generate Mockup
                                                    </button>
                                                    <button
                                                        onClick={() => handleDownload(img, `character-${idx + 1}.png`, true)}
                                                        className="w-full py-1.5 bg-slate-700 border border-slate-600 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded flex items-center justify-center"
                                                    >
                                                        <Download size={12} className="mr-1" /> Save PNG
                                                    </button>
                                                </div>
                                                <div className="absolute top-3 left-3 bg-black/60 text-white text-[10px] px-1.5 rounded border border-white/10">#{idx+1}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            
                            {splitImages.length === 0 && !isSplitting && (
                                <div className="text-center py-8 text-slate-600 border-2 border-dashed border-slate-800 rounded-xl">
                                    <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-20" />
                                    <p className="text-sm">No separated characters yet.</p>
                                </div>
                            )}
                         </>
                      )}
                  </div>
                )}

              </div>
              
              <div className="p-6 bg-slate-900 border-t border-slate-800">
                <p className="text-xs text-slate-600 text-center">
                  AI generation may take a few seconds. Results will replace the current view.
                </p>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
