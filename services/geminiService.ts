import { GoogleGenAI } from "@google/genai";
import { ProductAnalysis, DesignMode, RopeType, PRODUCT_MATERIALS, AppTab } from "../types";

// --- KEY MANAGER LOGIC ---
class KeyManager {
  private freeKeys: string[] = [];
  private paidKeys: string[] = [];
  private freeIndex = 0;
  private paidIndex = 0;

  // Store globally to persist across function calls
  setPools(free: string[], paid: string[]) {
    this.freeKeys = free;
    this.paidKeys = paid;
    this.freeIndex = 0;
    this.paidIndex = 0;
    console.log(`Key Manager Initialized: ${free.length} Free, ${paid.length} Paid`);
  }

  hasKeys() {
    return this.freeKeys.length > 0 || this.paidKeys.length > 0;
  }

  // Helper to determine if a key is a "Token" (OAuth - ya29...)
  isUserToken(key: string) {
    return key && key.startsWith('ya29');
  }

  getEnvKey() {
      return process.env.API_KEY || process.env.GEMINI_API_KEY;
  }

  // Core rotation execution
  async executeWithRetry<T>(operation: (key: string, isUltra: boolean, isPaidPool: boolean) => Promise<T>): Promise<T> {
    if (!this.hasKeys()) {
       // Fallback to env key if no pool
       const envKey = this.getEnvKey();
       if (!envKey) throw new Error("No API Keys configured. Please add keys.");
       return operation(envKey, this.isUserToken(envKey), false);
    }

    // Helper to check if error warrants rotation (Rate Limit OR Permission/Suspended OR Overloaded)
    const shouldRotate = (error: any) => {
        const msg = error?.message || '';
        return (
            error?.status === 429 || 
            error?.code === 429 || 
            msg.includes('429') || 
            msg.includes('quota') ||
            error?.status === 503 || // Service Unavailable / Overloaded
            error?.code === 503 ||
            msg.includes('503') ||
            msg.includes('overloaded') ||
            error?.status === 403 || // Permission denied (Suspended Key)
            msg.includes('Permission denied') ||
            msg.includes('API key not valid') ||
            msg.includes('suspended')
        );
    };

    let lastError: any = null;

    // 1. Try Free Keys Loop
    let initialFreeIndex = this.freeIndex;
    if (this.freeKeys.length > 0) {
        for (let i = 0; i < this.freeKeys.length; i++) {
            // Round robin selection
            const currentKeyIndex = (initialFreeIndex + i) % this.freeKeys.length;
            const key = this.freeKeys[currentKeyIndex];
            
            try {
                // Update global index for next time
                this.freeIndex = (currentKeyIndex + 1) % this.freeKeys.length;
                
                return await operation(key, this.isUserToken(key), false);
            } catch (error: any) {
                lastError = error;
                if (shouldRotate(error)) {
                    const isOverloaded = error?.status === 503 || (error?.message && error.message.includes('503'));
                    console.warn(`Free Key ${currentKeyIndex} failed (${error.status || 'Error'}). ${isOverloaded ? 'Model Overloaded' : 'Rate Limited'}. Rotating...`);
                    // IMPORTANT: Add delay before trying next key to avoid rapid-fire bans
                    await sleep(isOverloaded ? 3000 : 2000); 
                    continue; // Try next key
                }
                // If it's another error (e.g. 400 Bad Request), don't rotate, just fail
                throw error;
            }
        }
        console.warn("All Free Keys exhausted/rate-limited/suspended. Switching to Paid Pool.");
    }

    // 2. Try Paid Keys Loop (Failover)
    let initialPaidIndex = this.paidIndex;
    if (this.paidKeys.length > 0) {
        for (let i = 0; i < this.paidKeys.length; i++) {
             const currentKeyIndex = (initialPaidIndex + i) % this.paidKeys.length;
             const key = this.paidKeys[currentKeyIndex];

             try {
                 this.paidIndex = (currentKeyIndex + 1) % this.paidKeys.length;
                 // Pass isPaidPool=true. 
                 return await operation(key, this.isUserToken(key), true);
             } catch (error: any) {
                 lastError = error;
                 if (shouldRotate(error)) {
                     const isOverloaded = error?.status === 503 || (error?.message && error.message.includes('503'));
                     console.warn(`Paid Key ${currentKeyIndex} failed (${error.status || 'Error'}). Rotating...`);
                     await sleep(isOverloaded ? 2500 : 1500);
                     continue;
                 }
                 throw error;
             }
        }
    }

    // If we are here, ALL keys failed. Check the last error to give a better message.
    if (lastError) {
        const msg = lastError.message || '';
        if (lastError.status === 403 || msg.includes('suspended') || msg.includes('Permission denied')) {
            throw new Error("API Key has been SUSPENDED by Google. Please generate a new key from a new project.");
        }
        if (lastError.status === 503 || msg.includes('503')) {
             throw new Error("Google Gemini Service is currently overloaded (503). Please try again in a few moments.");
        }
    }

    throw new Error("All API Keys (Free & Paid) are currently unavailable (Rate Limited or Suspended). Please wait or check your keys.");
  }
}

export const keyManager = new KeyManager();

// --- CLIENT FACTORY ---
const getClient = (key: string, isPaidKey: boolean = false) => {
  if (!key) throw new Error("Missing Key");

  // Ultra Token Strategy (OAuth2 - ya29...)
  if (key.startsWith('ya29')) {
    const customFetch = (url: RequestInfo | URL, init?: RequestInit) => {
      const newInit = { ...init };
      const newHeaders = new Headers(newInit.headers);
      newHeaders.set('Authorization', `Bearer ${key}`);
      newHeaders.delete('x-goog-api-key');
      newInit.headers = newHeaders;
      return window.fetch(url, newInit);
    };

    return new GoogleGenAI({ 
      apiKey: 'BEARER_TOKEN_MODE', 
      fetch: customFetch 
    } as any);
  }

  // Standard API Key (AIza...)
  // If it's a Paid Key (AIza), we treat it as standard API key authentication.
  return new GoogleGenAI({ apiKey: key });
};

// Helper to strip base64 prefix
const stripBase64Prefix = (base64: string) => {
  return base64.replace(/^data:image\/[a-z]+;base64,/, "");
};

export const cleanJsonString = (text: string) => {
    return text.replace(/```json\s*|\s*```/g, "").trim();
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- EXPORTED SERVICES ---

// 1. Configuration (Called from App.tsx)
export const setKeyPools = (free: string[], paid: string[]) => {
  keyManager.setPools(free, paid);
};

// 2. Validation
export const validateToken = async (token: string): Promise<boolean> => {
  try {
    const ai = getClient(token);
    // Use Flash for validation as it's the most available model
    await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [{ text: "test" }] }
    });
    return true;
  } catch (err: any) {
    console.error("Validation error:", err);
    throw err;
  }
};

// 3. Cleanup
export const cleanupProductImage = async (imageBase64: string): Promise<string> => {
  return keyManager.executeWithRetry(async (key, isUltra, isPaidPool) => {
      const ai = getClient(key, isPaidPool);
      
      if (!isUltra) {
          await sleep(isPaidPool ? 500 : 1000);
      }

      // Updated Prompt: Strict instruction for White Background and Removing Ropes
      const prompt = `Professional Product Photography Editing Task:
      1. Isolate the main product on a pure solid WHITE background (Hex #FFFFFF).
      2. CRITICAL: ERASE ALL hanging strings, loops, hooks, wires, and attachments used to suspend the object. The object must appear to float freely or stand on its own.
      3. Do NOT crop any part of the main product. Keep it complete.
      4. Maintain high resolution and sharp edge details.
      5. Output ONLY the processed image.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
            { text: prompt }
          ]
        }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData && part.inlineData.data) {
              return `data:image/png;base64,${part.inlineData.data}`;
          }
      }
      console.warn("Cleanup returned no image, using original.");
      return imageBase64;
  });
};

// 4. Analysis
export const analyzeProductDesign = async (
    imageBase64: string, 
    productType: string,
    designMode: DesignMode,
    activeTab: AppTab = AppTab.POD,
    preferredModel: string = 'gemini-2.5-flash'
  ): Promise<ProductAnalysis> => {
    
    return keyManager.executeWithRetry(async (key, isUltra, isPaidPool) => {
        const ai = getClient(key, isPaidPool);
        
        // Strategy: Ultra Token gets Pro. Others get Flash.
        // OPTIMIZATION: For T-Shirt mode, ALWAYS use 'gemini-2.5-flash' (standard) to avoid 503 on Pro and speed up prompt gen.
        let activeModel = 'gemini-2.5-flash';
        if (activeTab !== AppTab.TSHIRT && (isUltra || isPaidPool)) {
             activeModel = 'gemini-3-pro-preview';
        }

        if (!isUltra) {
             await sleep(isPaidPool ? 500 : 1000);
        }

        let prompt = "";

        if (activeTab === AppTab.TSHIRT) {
            prompt = `Analyze this T-Shirt Design / Graphic.
            Task:
            1. Describe the graphic style (e.g., Vintage, Typography, Illustration, Anime).
            2. List key elements (text, characters, colors).
            3. Create a 'redesignPrompt' to generate 3 NEW, BETTER T-shirt graphics based on this style.
            
            IMPORTANT for 'redesignPrompt':
            - The prompt MUST explicitly request a "SINGLE UNIFIED GRAPHIC".
            - FORBID grids, collections, or multiple stickers.
            - ISOLATED on WHITE background.
            - NO T-shirt mockup in the generated image. JUST THE GRAPHIC.
            - High contrast, professionally color separated look.
            
            Return JSON: { description, designCritique, detectedComponents, redesignPrompt }`;
        } else {
             // POD / ORNAMENT MODE
            const isAutoDetect = productType === "Auto-Detect / Random";
            let materialInfo = "";
            let typeInstruction = "";
    
            if (isAutoDetect) {
               typeInstruction = "First, IDENTIFY the product type (e.g., Ornament, Suncatcher, Home Decor) and its likely materials based on the image visual cues. Then proceed with the analysis.";
            } else {
               materialInfo = PRODUCT_MATERIALS[productType] || "";
               typeInstruction = `Product Type: ${productType}\nMaterial Specs: ${materialInfo}`;
            }
    
            prompt = `Analyze this product image for a redesign task.
            ${typeInstruction}
            Design Goal: ${designMode === DesignMode.NEW_CONCEPT ? "Create a completely new creative concept" : "Enhance existing design"}.
          
            Task:
            1. Analyze the image.
            2. Provide a description and critique.
            3. List detected components (characters, text, patterns).
            4. Create a 'redesignPrompt' that generates a BETTER, High-Quality version of this product. ${isAutoDetect ? "Explicitly mention the identified product type and premium materials in this prompt." : `Explicitly mention it is a '${productType}' with '${materialInfo}'.`}
    
            Return a JSON object with fields: description, designCritique, detectedComponents, redesignPrompt.
            IMPORTANT: detectedComponents must be an array of strings.
            `;
        }
        
        try {
            const response = await ai.models.generateContent({
                model: activeModel,
                contents: {
                parts: [
                    { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                    { text: prompt }
                ]
                },
                config: { responseMimeType: "application/json" }
            });

            const text = response.text || "{}";
            const rawResult = JSON.parse(cleanJsonString(text));

            // SANITIZE
            let components = rawResult.detectedComponents;
            if (typeof components === 'string') {
                components = components.split(',').map((s: string) => s.trim());
            } else if (!Array.isArray(components)) {
                components = [];
            }

            return {
                ...rawResult,
                detectedComponents: components
            } as ProductAnalysis;

        } catch (error: any) {
            // Fallback logic if Pro model fails
            if (activeModel !== 'gemini-2.5-flash') {
                console.warn(`Pro model failed (${error.status || 'Error'}), falling back to Flash on same key.`);
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: {
                        parts: [
                            { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                            { text: prompt }
                        ]
                    },
                    config: { responseMimeType: "application/json" }
                });
                const text = response.text || "{}";
                const rawResult = JSON.parse(cleanJsonString(text));
                
                let components = rawResult.detectedComponents;
                if (typeof components === 'string') {
                    components = components.split(',').map((s: string) => s.trim());
                } else if (!Array.isArray(components)) {
                    components = [];
                }
                return { ...rawResult, detectedComponents: components } as ProductAnalysis;
            }
            throw error;
        }
    });
  };

// 5. Extract Elements
export const extractDesignElements = async (imageBase64: string): Promise<string[]> => {
  // REDUCED QUOTA CONSUMPTION: Only 1 prompt instead of 3.
  const prompts = [
    "Crop and isolate the main CHARACTER or central figure."
  ];

  const results: string[] = [];

  for (const prompt of prompts) {
      try {
        const img = await keyManager.executeWithRetry(async (key, isUltra, isPaidPool) => {
            const ai = getClient(key, isPaidPool);
            if (!isUltra) await sleep(isPaidPool ? 500 : 1000);

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: {
                    parts: [
                        { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                        { text: prompt }
                    ]
                }
            });
            
            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData && part.inlineData.data) {
                    return `data:image/png;base64,${part.inlineData.data}`;
                }
            }
            return null;
        });
        if (img) results.push(img);
      } catch (e) { 
          console.error("Extraction partial fail (Ignored to save flow)", e); 
          // Do not throw here, allow the app to continue even if extraction fails
      }
  }
  return results;
};

// 6. Generate Redesigns (Logic Updated for Ultra Tokens & T-Shirt Mode)
export const generateProductRedesigns = async (
    basePrompt: string,
    ropeType: RopeType,
    selectedComponents: string[],
    userNotes: string,
    productType: string,
    useUltraFlag: boolean,
    activeTab: AppTab = AppTab.POD
  ): Promise<string[]> => {
    
    // 1. Construct the Prompt
    let finalPrompt = basePrompt;
    
    if (activeTab === AppTab.TSHIRT) {
        finalPrompt += `\n\nCRITICAL OUTPUT REQUIREMENT:
        - **SINGLE IMAGE ONLY**: Generate exactly ONE unified graphic.
        - **STRICTLY FORBIDDEN**: Do NOT generate a grid, sticker sheet, collage, or multiple variations in one image.
        - **STRICTLY FORBIDDEN**: Do NOT generate a T-shirt mockup, model, or folded shirt. OUTPUT THE ARTWORK ONLY.
        - **COMPOSITION**: Centered, single main subject.
        - **BACKGROUND**: Solid Pure White (#FFFFFF).
        - **QUALITY**: 2K Resolution, Vector style, sharp edges for print.`;
        if (userNotes) finalPrompt += `\nUser Request: ${userNotes}`;
    } else {
        // Standard POD Logic
        const isAutoDetect = productType === "Auto-Detect / Random";
        if (!isAutoDetect) {
           const materialInfo = PRODUCT_MATERIALS[productType] || "";
           finalPrompt += `\n\nMaterial Specs: ${materialInfo}`;
        } else {
            finalPrompt += `\n\nEnsure High-Quality Material Rendering appropriate for this product type.`;
        }
    
        if (ropeType !== RopeType.NONE) finalPrompt += `\nAdd ${ropeType} loop.`;
        if (userNotes) finalPrompt += `\nUser Request: ${userNotes}`;
        if (selectedComponents.length > 0) finalPrompt += `\nKeep elements: ${selectedComponents.join(", ")}.`;
    
        if (productType.includes('Acrylic') || productType.includes('Suncatcher') || (isAutoDetect && basePrompt.toLowerCase().includes('acrylic'))) {
           finalPrompt += `\n\nCRITICAL PHYSICAL PROPERTIES:
           - The material MUST be depicted as a THIN (3mm) sheet. Do NOT render it as a thick block.
           - CUTLINE: The acrylic must be laser-cut VERY CLOSE to the design edge (Kiss-cut).
           - TRANSPARENCY: Optically clear background.`;
        }
    
        finalPrompt += `\n\nIMPORTANT PRESENTATION: Generate this as a High-Quality Product Photography Mockup.
        - The product should be hanging or placed in a beautiful, realistic environment.
        - Do NOT use a plain white background.
        - Use cinematic lighting, depth of field (bokeh).`;
    }


    // --- GENERATION STRATEGY ---
    const count = activeTab === AppTab.TSHIRT ? 3 : 6; // 3 for Tshirt, 6 for POD
    
    // Helper: Execute a single generation via Flash Image (General Quota)
    const runFlashGen = async (key: string, isPaidPool: boolean) => {
         const ai = getClient(key, isPaidPool);
         const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: finalPrompt }] }
         });
         for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData && part.inlineData.data) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
         }
         return null;
    };

    // ULTRA TOKEN PATH (Parallel Batching + General Quota)
    if (keyManager['paidKeys'].some(k => k.startsWith('ya29'))) {
         return keyManager.executeWithRetry(async (key, isUltra, isPaidPool) => {
             // Only apply this logic if it is indeed an Ultra Token
             if (isUltra) {
                 console.log("Using Ultra Token Strategy: Parallel Batching with Flash Image");
                 
                 // If count is 3, just one batch
                 if (count === 3) {
                     const batch = [runFlashGen(key, true), runFlashGen(key, true), runFlashGen(key, true)];
                     const results = await Promise.all(batch);
                     return results.filter(r => r !== null) as string[];
                 }

                 // If count is 6, do 2 batches
                 const batch1Promises = [runFlashGen(key, true), runFlashGen(key, true), runFlashGen(key, true)];
                 const results1 = await Promise.all(batch1Promises);
                 
                 await sleep(500); 

                 const batch2Promises = [runFlashGen(key, true), runFlashGen(key, true), runFlashGen(key, true)];
                 const results2 = await Promise.all(batch2Promises);
                 
                 const allResults = [...results1, ...results2].filter(r => r !== null) as string[];
                 return allResults;
             } 
             // If key rotated to a non-ultra key inside this block (rare), fallback to standard loop below
             return [];
         }).then(res => {
             if (res.length > 0) return res;
             throw new Error("Ultra generation returned empty, falling back.");
         }).catch(async (e) => {
             console.warn("Ultra batch failed, falling back to standard sequential:", e);
             return await standardSequentialGeneration(finalPrompt, count);
         });
    }

    // STANDARD PATH (Sequential + Sleep)
    return await standardSequentialGeneration(finalPrompt, count);
};

// Helper for standard generation loop
async function standardSequentialGeneration(prompt: string, count: number): Promise<string[]> {
    const results: string[] = [];
    for(let i=0; i<count; i++) {
        await sleep(500); // Stagger
        const img = await keyManager.executeWithRetry(async (key, isUltra, isPaidPool) => {
             const ai = getClient(key, isPaidPool);
             
             if (!isUltra) {
                 await sleep(isPaidPool ? 2500 : 2000); 
             }

             // FORCE USE OF GEMINI 2.5 FLASH IMAGE (Free Tier Compatible)
             // We removed the Imagen 4.0 try/catch block because it requires Billing.
             const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [{ text: prompt }] }
             });
             for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData && part.inlineData.data) {
                    return `data:image/png;base64,${part.inlineData.data}`;
                }
             }
             return null;
        }).catch(e => {
            console.warn("Generation failed", e);
            return null;
        });
        
        if (img) results.push(img);
    }
    return results;
}

// 7. Remix
export const remixProductImage = async (imageBase64: string, instruction: string): Promise<string> => {
    const prompt = `Image Editor. Instruction: ${instruction}. Preserve Text spelling exactly.`;
    
    return keyManager.executeWithRetry(async (key, isUltra, isPaidPool) => {
        const ai = getClient(key, isPaidPool);
        if (!isUltra) await sleep(isPaidPool ? 500 : 1000);
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                    { text: prompt }
                ]
            }
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData && part.inlineData.data) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
        throw new Error("Remix failed to generate image");
    });
};

// 8. Split Characters
export const detectAndSplitCharacters = async (imageBase64: string): Promise<string[]> => {
    return keyManager.executeWithRetry(async (key, isUltra, isPaidPool) => {
        const ai = getClient(key, isPaidPool);
        if (!isUltra) await sleep(isPaidPool ? 500 : 1000);

        const identifyPrompt = "Analyze image. List the main distinct characters (humans, animals, snowmen) visible. Return a comma-separated list of their names/descriptions. Ignore small background elements.";
        
        const identifyResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                    { text: identifyPrompt }
                ]
            }
        });
        const characterList = identifyResponse.text?.split(',').map(s => s.trim()) || [];
        
        if (characterList.length === 0) return [];

        // Parallel generation for tokens is safer here too
        const generateIsolated = async (charName: string) => {
             const isolatePrompt = `Crop and isolate ONLY the ${charName} from this image. Place it on a PURE WHITE background. High resolution.`;
             const resp = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                 contents: {
                    parts: [
                        { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                        { text: isolatePrompt }
                    ]
                }
             });
             const part = resp.candidates?.[0]?.content?.parts?.[0];
             if (part?.inlineData?.data) {
                 return `data:image/png;base64,${part.inlineData.data}`;
             }
             return null;
        };

        const promises = characterList.slice(0, 4).map(c => generateIsolated(c));
        const results = await Promise.all(promises);
        const isolatedImages: string[] = [];
        results.forEach(r => { if(r) isolatedImages.push(r); });
        
        return isolatedImages;
    });
};

// 9. Random Mockup
export const generateRandomMockup = async (imageBase64: string): Promise<string> => {
    return keyManager.executeWithRetry(async (key, isUltra, isPaidPool) => {
        const ai = getClient(key, isPaidPool);
        if (!isUltra) await sleep(isPaidPool ? 500 : 1000);
        
        const prompt = `Image Editor. 
        Action: Place this isolated object into a professional Print-on-Demand (POD) product photography setting.
        Logic:
        - If Ornament: Hang on a Christmas tree with bokeh lights.
        - Else: Place on a rustic wooden table with cinematic lighting.
        Requirement: High-resolution, photorealistic.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                    { text: prompt }
                ]
            }
        });
        
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData && part.inlineData.data) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
        throw new Error("Mockup generation failed.");
    });
};