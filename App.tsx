import React, { useState, useEffect, useRef } from 'react';
import { Flow } from 'flow-sdk';
import { SellingPoint, GlobalContext, MediaAsset } from './types';
import { 
  extractVisualParams, 
  generateNarrative, 
  compilePrompt, 
  extractGlobalParams, 
  parseAspectRatio,
  resolveActiveModelIds,
  getActiveModels,
  withSpEnv,
  buildGenerationRefs
} from './services/workflow';
// --- Utils ---
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
// --- Hooks ---
function useOnClickOutside(ref: React.RefObject<HTMLElement | null>, handler: (e: MouseEvent | TouchEvent) => void) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler(event);
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => { 
      document.removeEventListener('mousedown', listener); 
      document.removeEventListener('touchstart', listener); 
    };
  }, [ref, handler]);
}
// --- UI Primitives ---
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center px-2">
    <span className="text-[11px] font-medium text-[rgba(218,220,224,0.9)] tracking-[0.1px]">
      {children}
    </span>
  </div>
);
const PillButton: React.FC<{
  icon?: React.ReactNode; children: React.ReactNode;
  variant?: 'filled' | 'outline' | 'solid'; onClick?: () => void;
  disabled?: boolean; className?: string;
}> = ({ icon, children, variant = 'filled', onClick, disabled, className = '' }) => {
  const base = 'flex items-center gap-[2px] justify-center h-[34px] rounded-xl font-medium tracking-[0.1px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const variants: Record<string, string> = {
    filled: 'bg-[#969696] hover:bg-[#a6a6a6] active:bg-[#868686] text-black text-[11px] px-4 py-1 select-none',
    outline: 'border border-[#595959] hover:bg-white/5 active:bg-white/10 backdrop-blur-[40px] text-[12px] px-4 py-2 text-white select-none',
    solid: 'bg-white hover:bg-gray-200 active:bg-gray-300 text-black text-[12px] px-4 py-2 select-none',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} onClick={onClick} disabled={disabled}>
      {icon && <span className="flex items-center justify-center w-5 h-5 mr-1">{icon}</span>}
      <span>{children}</span>
    </button>
  );
};
const TextInput: React.FC<{
  value: string; onChange: (val: string) => void; placeholder?: string; rows?: number;
  className?: string;
}> = ({ value, onChange, placeholder, rows = 3, className = '' }) => (
  <textarea 
    value={value} 
    onChange={(e) => onChange(e.target.value)} 
    placeholder={placeholder}
    className={`border border-[#595959] hover:border-[#7a7a7a] focus:border-[#969696] rounded-xl w-full px-3 py-2.5 resize-none bg-transparent text-[11px] font-medium text-white placeholder-[rgba(218,220,224,0.75)] tracking-[0.1px] focus:outline-none transition-colors ${className}`}
    style={{ height: `${rows * 20}px` }}
  />
);
const FieldDropdown: React.FC<{
  label: string; value: string; options: string[];
  onChange: (val: string) => void; className?: string;
}> = ({ label, value, options, onChange, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setIsOpen(false));
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left border border-[#595959] hover:border-[#7a7a7a] rounded-xl flex flex-col gap-0.5 pb-2 pl-2.5 pr-1 pt-[5px] select-none">
        <p className="text-[11px] text-white/40">{label}</p>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white">{value}</span>
          <span className="material-symbols-outlined text-[16px] text-white/50">keyboard_arrow_down</span>
        </div>
      </button>
      {isOpen && (
        <div className="absolute z-50 top-full mt-1 left-0 w-full bg-[#0e0e0e] border border-[#595959] rounded-xl overflow-hidden shadow-xl animate-dropdown origin-top">
          {options.map((opt) => (
            <button key={opt} type="button"
              className={`w-full text-left px-2.5 py-2 text-[11px] hover:bg-white/10 ${value === opt ? 'bg-white/10' : ''}`}
              onClick={() => { onChange(opt); setIsOpen(false); }}>{opt}</button>
          ))}
        </div>
      )}
    </div>
  );
};
const MediaPreview: React.FC<{ 
  item?: { base64: string; mimeType: string }; 
  label: string; 
  onSelect: () => void;
  onClear: () => void;
  className?: string;
}> = ({ item, label, onSelect, onClear, className = '' }) => (
  <div className={`group relative aspect-square bg-[#1a1a1a] rounded-xl border border-[#595959] overflow-hidden flex flex-col items-center justify-center cursor-pointer ${className}`} onClick={onSelect}>
    {item ? (
      <>
        <img src={`data:${item.mimeType};base64,${item.base64}`} className="w-full h-full object-cover" />
        <button 
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="absolute top-1 right-1 w-5 h-5 bg-black/50 hover:bg-black rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <span className="material-symbols-outlined text-[14px] text-white">close</span>
        </button>
      </>
    ) : (
      <div className="flex flex-col items-center gap-1 opacity-40">
        <span className="material-symbols-outlined text-[20px]">add_photo_alternate</span>
        <span className="text-[9px] uppercase tracking-wider text-center">{label}</span>
      </div>
    )}
  </div>
);
// --- Main App ---
export default function VisualPromptApp() {
  const [globalContext, setGlobalContext] = useState<GlobalContext>({
    product_info: '',
    brand_tone: '',
    output_spec: '16:9',
    modelReferences: [{ id: 'm1' }],
    global_analysis: null,
  });
  
  const [sellingPoints, setSellingPoints] = useState<SellingPoint[]>([
    {
      sp_id: 'sp_01',
      name: '',
      description: '',
      status: 'idle',
      modelMode: 'auto',
      envMode: 'global',
      enrichment: { visual_params: null, narrative_concept: null, final_prompt: null }
    }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      html, body, #root { background: #0e0e0e; color: white; height: 100%; font-family: 'Google Sans Text', sans-serif; }
      @keyframes dropdown-enter { from { opacity: 0; transform: scale(0.95) translateY(-5px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      .animate-dropdown { animation: dropdown-enter 0.15s ease-out forwards; }
    `;
    document.head.appendChild(style);
  }, []);
  const selectMedia = async (type: 'global' | 'product' | 'environment' | 'model' | 'suit' | 'sp' | 'sp_env', id?: string | number) => {
    const media = await Flow.media.select({ filter: 'image' });
    if (!media) return;
    if (type === 'sp') {
      updateSP(id as number, { referenceImage: media });
    } else if (type === 'sp_env') {
      updateSP(id as number, { environmentImage: media, envMode: 'custom' });
    } else if (type === 'global') {
      setGlobalContext(prev => ({ ...prev, globalStyleImage: media, global_analysis: null }));
    } else if (type === 'product') {
      setGlobalContext(prev => ({ ...prev, productImage: media }));
    } else if (type === 'environment') {
      setGlobalContext(prev => ({ ...prev, environmentImage: media }));
    } else if (id) {
      setGlobalContext(prev => ({
        ...prev,
        modelReferences: prev.modelReferences.map(m => m.id === id ? { ...m, [type]: media } : m)
      }));
    }
  };
  const clearModelAsset = (id: string, type: 'model' | 'suit') => {
    setGlobalContext(prev => ({
      ...prev,
      modelReferences: prev.modelReferences.map(m => m.id === id ? { ...m, [type]: undefined } : m)
    }));
  };
  const updateSP = (index: number, updates: Partial<SellingPoint>) => {
    setSellingPoints(prev => {
      const newSPs = [...prev];
      newSPs[index] = { ...newSPs[index], ...updates };
      return newSPs;
    });
  };
  const toggleManualModel = (spIdx: number, modelId: string) => {
    const sp = sellingPoints[spIdx];
    const current = sp.manualModelIds || [];
    const next = current.includes(modelId) 
      ? current.filter(id => id !== modelId) 
      : [...current, modelId];
    updateSP(spIdx, { manualModelIds: next });
  };
  const runPreparation = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    let currentIdx = -1;
    try {
      let currentGlobal = { ...globalContext };
      
      if (currentGlobal.globalStyleImage && !currentGlobal.global_analysis) {
        const analysis = await extractGlobalParams(currentGlobal.globalStyleImage);
        currentGlobal = { ...currentGlobal, global_analysis: analysis };
        setGlobalContext(currentGlobal);
      }
      for (let i = 0; i < sellingPoints.length; i++) {
        currentIdx = i;
        const sp = sellingPoints[i];
        if (!sp.name.trim() || sp.status === 'completed' || sp.status === 'generating') continue;
        
        updateSP(i, { status: 'analyzing', error: undefined });
        const visual = await extractVisualParams(sp, currentGlobal);
        
        const withVisual = { ...sp, enrichment: { ...sp.enrichment, visual_params: visual } };
        const activeModelIds = resolveActiveModelIds(withVisual, currentGlobal);
        const spReady = { ...withVisual, activeModelIds };
        
        updateSP(i, { 
          status: 'narrating', 
          activeModelIds,
          enrichment: { ...sp.enrichment, visual_params: visual } 
        });
        await sleep(600);
        const narrative = await generateNarrative(spReady, currentGlobal, sellingPoints);
        await sleep(600);
        
        updateSP(i, { 
          status: 'compiling', 
          enrichment: { ...spReady.enrichment, narrative_concept: narrative } 
        });
        const prompt = compilePrompt({ 
          ...spReady, 
          enrichment: { ...spReady.enrichment, narrative_concept: narrative } 
        }, currentGlobal);
        
        updateSP(i, { 
          status: 'awaiting_review', 
          enrichment: { ...spReady.enrichment, narrative_concept: narrative, final_prompt: prompt } 
        });
        await sleep(800);
      }
    } catch (err) {
      console.error(err);
      if (currentIdx >= 0) {
        updateSP(currentIdx, { status: 'error', error: String(err) });
      }
      alert(String(err));
    } finally {
      setIsProcessing(false);
    }
  };
  const confirmAndGenerate = async (index: number) => {
    const sp = sellingPoints[index];
    if (sp.status !== 'awaiting_review' || !sp.enrichment.final_prompt) return;
    
    try {
      updateSP(index, { status: 'generating', error: undefined });
      const refs = buildGenerationRefs(sp, globalContext);
      
      const result = await Flow.generate.image({
        prompt: sp.enrichment.final_prompt,
        modelDisplayName: '🍌 Nano Banana Pro',
        aspectRatio: parseAspectRatio(globalContext.output_spec),
        referenceImageMediaIds: refs.map(r => r.asset.mediaId).slice(0, 14)
      });
      
      updateSP(index, { status: 'completed', enrichment: { ...sp.enrichment, generatedImage: result } });
    } catch (err) {
      console.error(err);
      updateSP(index, { status: 'error', error: String(err) });
    }
  };
  const availableGlobalModels = globalContext.modelReferences
    .map((m, i) => ({ ...m, letter: String.fromCharCode(65 + i) }))
    .filter(m => m.model || m.suit);
  return (
    <div className="flex h-screen w-screen bg-[#0e0e0e]">
      {/* Sidebar */}
      <div className="w-[320px] border-r border-white/15 flex flex-col p-3 gap-5 overflow-y-auto">
        <div className="flex flex-col gap-2">
          <SectionLabel>Campaign Context</SectionLabel>
          <TextInput value={globalContext.product_info} onChange={v => setGlobalContext({ ...globalContext, product_info: v })} placeholder="Product specs..." rows={2} />
          <TextInput value={globalContext.brand_tone} onChange={v => setGlobalContext({ ...globalContext, brand_tone: v })} placeholder="Brand tone..." rows={2} />
          <FieldDropdown label="Output Format" value={globalContext.output_spec} options={['1:1', '16:9', '9:16', '4:3', '3:4']} onChange={v => setGlobalContext({ ...globalContext, output_spec: v })} />
        </div>
        <div className="flex flex-col gap-2">
          <SectionLabel>Universal Assets</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            <MediaPreview label="Style" item={globalContext.globalStyleImage} onSelect={() => selectMedia('global')} onClear={() => setGlobalContext({ ...globalContext, globalStyleImage: undefined, global_analysis: null })} />
            <MediaPreview label="Product" item={globalContext.productImage} onSelect={() => selectMedia('product')} onClear={() => setGlobalContext({ ...globalContext, productImage: undefined })} />
            <MediaPreview label="Env" item={globalContext.environmentImage} onSelect={() => selectMedia('environment')} onClear={() => setGlobalContext({ ...globalContext, environmentImage: undefined })} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <SectionLabel>Character Inventory</SectionLabel>
          {globalContext.modelReferences.map((m, idx) => (
            <div key={m.id} className="p-2 bg-white/5 rounded-xl border border-white/10 flex flex-col gap-2">
              <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">Model {String.fromCharCode(65 + idx)}</span>
              <div className="grid grid-cols-2 gap-2">
                <MediaPreview label="Model" item={m.model} onSelect={() => selectMedia('model', m.id)} onClear={() => clearModelAsset(m.id, 'model')} />
                <MediaPreview label="Suit" item={m.suit} onSelect={() => selectMedia('suit', m.id)} onClear={() => clearModelAsset(m.id, 'suit')} />
              </div>
            </div>
          ))}
          <PillButton variant="outline" onClick={() => setGlobalContext({ ...globalContext, modelReferences: [...globalContext.modelReferences, { id: `m${globalContext.modelReferences.length + 1}` }] })} icon={<span className="material-symbols-outlined text-[16px]">add</span>}>Add Person</PillButton>
        </div>
        <div className="mt-auto pt-4">
          <PillButton variant="solid" onClick={runPreparation} disabled={isProcessing} className="w-full !bg-blue-600 !text-white" icon={<span className="material-symbols-outlined">auto_fix_high</span>}>
            {isProcessing ? 'Thinking...' : 'Process Campaign'}
          </PillButton>
        </div>
      </div>
      {/* Main Panel */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-medium">Selling Points</h1>
            <PillButton variant="outline" onClick={() => setSellingPoints([...sellingPoints, { sp_id: `sp_${sellingPoints.length + 1}`, name: '', description: '', status: 'idle', modelMode: 'auto', envMode: 'global', enrichment: { visual_params: null, narrative_concept: null, final_prompt: null } }])} icon={<span className="material-symbols-outlined">add</span>}>New Point</PillButton>
          </div>
          {sellingPoints.map((sp, idx) => {
            const modelModeMap: Record<string, SellingPoint['modelMode']> = {
              'Auto (by selling point)': 'auto',
              'Manual pick': 'with_model',
              'No models (product only)': 'no_model'
            };
            const currentModelModeLabel = Object.keys(modelModeMap).find(k => modelModeMap[k] === (sp.modelMode || 'auto')) || 'Auto (by selling point)';
            const envModeMap: Record<string, SellingPoint['envMode']> = {
              'Use global Env': 'global',
              'Custom for this point': 'custom',
              'No environment image': 'none'
            };
            const currentEnvModeLabel = Object.keys(envModeMap).find(k => envModeMap[k] === (sp.envMode || 'global')) || 'Use global Env';
            return (
              <div key={sp.sp_id} className="bg-[#141414] border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
                {/* Overhead Controls (K9) */}
                <div className="flex flex-col gap-3 pb-5 border-b border-white/5">
                  <div className="grid grid-cols-2 gap-4 items-start">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <FieldDropdown 
                          label="Model usage" 
                          value={currentModelModeLabel} 
                          options={Object.keys(modelModeMap)} 
                          onChange={val => updateSP(idx, { modelMode: modelModeMap[val] })}
                          className="w-[200px]"
                        />
                        {sp.modelMode === 'with_model' && (
                          <div className="flex flex-col gap-1">
                            <div className="flex gap-1.5 flex-wrap">
                              {availableGlobalModels.map(m => (
                                <button 
                                  key={m.id}
                                  onClick={() => toggleManualModel(idx, m.id)}
                                  className={`w-7 h-7 flex items-center justify-center rounded-lg border text-[11px] font-bold transition-all ${
                                    (sp.manualModelIds || []).includes(m.id) 
                                      ? 'bg-blue-500 border-blue-400 text-white shadow-[0_0_10px_rgba(59,130,246,0.3)]' 
                                      : 'bg-white/5 border-white/10 text-white/30 hover:border-white/30'
                                  }`}
                                >
                                  {m.letter}
                                </button>
                              ))}
                            </div>
                            {(sp.manualModelIds || []).length === 0 && (
                              <p className="text-[9px] text-white/20 italic ml-1">None ticked = use all models</p>
                            )}
                          </div>
                        )}
                      </div>
                      {sp.enrichment.visual_params && (
                        <p className="text-[10px] text-white/30 font-medium px-2">
                          Type: <span className="text-white/60">{sp.enrichment.visual_params.image_type}</span> · 
                          <span className="text-white/60 ml-1">
                            {sp.enrichment.visual_params.requires_model ? 'with models' : 'no models'}
                          </span> (re-run Process after changing)
                        </p>
                      )}
                    </div>
                    <div className="flex gap-3 items-start justify-end">
                      {sp.envMode === 'custom' && (
                        <div className="flex flex-col gap-1">
                          <MediaPreview 
                            label="Env" 
                            item={sp.environmentImage} 
                            onSelect={() => selectMedia('sp_env', idx)} 
                            onClear={() => updateSP(idx, { environmentImage: undefined })}
                            className="!w-16 !h-16"
                          />
                          {!sp.environmentImage && (
                            <p className="text-[9px] text-white/20 italic w-32 leading-tight">Upload an env image, otherwise no environment reference is used</p>
                          )}
                        </div>
                      )}
                      <FieldDropdown 
                        label="Environment" 
                        value={currentEnvModeLabel} 
                        options={Object.keys(envModeMap)} 
                        onChange={val => updateSP(idx, { envMode: envModeMap[val] })}
                        className="w-[200px]"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div className="w-32 shrink-0 flex flex-col gap-2">
                    <MediaPreview label="Reference" item={sp.referenceImage} onSelect={() => selectMedia('sp', idx)} onClear={() => updateSP(idx, { referenceImage: undefined })} />
                  </div>
                  <div className="flex-1 flex flex-col gap-3">
                    <input className="bg-transparent border-b border-white/10 text-lg outline-none font-medium py-1" placeholder="Title" value={sp.name} onChange={e => updateSP(idx, { name: e.target.value })} />
                    <textarea className="bg-transparent text-sm text-white/50 outline-none resize-none h-20" placeholder="Description..." value={sp.description} onChange={e => updateSP(idx, { description: e.target.value })} />
                    
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] uppercase text-white/30 font-bold">Planned Models:</span>
                      {getActiveModels(sp, globalContext).map(({ letter }) => (
                        <span key={letter} className="w-5 h-5 flex items-center justify-center bg-blue-500/20 text-blue-300 text-[10px] rounded-md font-bold">{letter}</span>
                      ))}
                      {getActiveModels(sp, globalContext).length === 0 && <span className="text-[10px] text-white/20 italic">None (Product Only)</span>}
                    </div>
                  </div>
                </div>
                
                {sp.status === 'awaiting_review' && (
                  <div className="mt-2 pt-6 border-t border-white/10 flex flex-col gap-4">
                    <TextInput value={sp.enrichment.final_prompt || ''} onChange={v => updateSP(idx, { enrichment: { ...sp.enrichment, final_prompt: v } })} rows={6} className="!bg-black/40" />
                    <PillButton variant="solid" className="w-full" onClick={() => confirmAndGenerate(idx)} icon={<span className="material-symbols-outlined">bolt</span>}>Generate Visual</PillButton>
                  </div>
                )}
                {sp.status === 'completed' && sp.enrichment.generatedImage && (
                  <div className="mt-2 p-4 bg-black/40 rounded-xl border border-white/5 flex gap-4">
                    <img src={`data:${sp.enrichment.generatedImage.mimeType};base64,${sp.enrichment.generatedImage.base64}`} className="w-48 h-48 object-cover rounded-lg" />
                    <div className="flex-1 flex flex-col justify-between">
                       <p className="text-sm font-medium">{sp.name}</p>
                       <div className="flex gap-2">
                          <PillButton variant="outline" className="flex-1" onClick={() => updateSP(idx, { status: 'awaiting_review' })}>Tweak</PillButton>
                          <PillButton variant="outline" onClick={() => Flow.download({ base64: sp.enrichment.generatedImage!.base64, mimeType: sp.enrichment.generatedImage!.mimeType, filename: `${sp.name}.png` })} icon={<span className="material-symbols-outlined">download</span>}>Export</PillButton>
                       </div>
                    </div>
                  </div>
                )}
                {sp.status === 'error' && (
                  <div className="mt-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-red-400">
                      <span className="material-symbols-outlined text-[18px]">error</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider">Workflow Failure</span>
                    </div>
                    <p className="text-[11px] text-red-400/80 leading-relaxed break-words line-clamp-2">
                      {sp.error || 'An unexpected error occurred during orchestration.'}
                    </p>
                    <div className="flex gap-2 mt-1">
                      <PillButton 
                        variant="outline" 
                        className="flex-1 !h-[30px] !border-red-500/30 hover:!bg-red-500/10 !text-red-400 !text-[10px]" 
                        onClick={() => sp.enrichment.final_prompt ? confirmAndGenerate(idx) : runPreparation()}
                      >
                        Retry {sp.enrichment.final_prompt ? 'Generation' : 'Orchestration'}
                      </PillButton>
                    </div>
                  </div>
                )}
                {sp.status !== 'idle' && !['completed', 'awaiting_review', 'error'].includes(sp.status) && (
                  <div className="flex items-center gap-3 text-blue-400 text-xs py-4">
                    <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin"></div>
                    <span className="uppercase tracking-widest font-bold">Orchestrating {sp.status}...</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
