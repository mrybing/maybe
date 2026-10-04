import { Flow } from 'flow-sdk';
import { SellingPoint, GlobalContext, VisualParams, NarrativeConcept, GlobalAnalysis, ModelSuitPair, MediaAsset } from '../types';
/**
 * K5: Data structure for a generation reference.
 */
export interface GenRef { 
  index: number; 
  token: string; 
  noun: string; 
  caption: string; 
  asset: MediaAsset; 
}
/**
 * Utility: Safe JSON Parsing with basic self-healing
 */
async function safeParseJSON<T>(text: string, context: string): Promise<T> {
  let cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const fixPrompt = `The following text was intended to be JSON but is invalid. Correct it to be a pure, valid JSON object. 
Context: ${context}
Text to fix:
${text}`;
    const { text: fixedText } = await Flow.generate.text(fixPrompt, { systemInstruction: "Output ONLY valid JSON." });
    try {
      return JSON.parse(fixedText.replace(/```json|```/g, '').trim());
    } catch (e2) {
      throw new Error(`Failed to parse ${context} after retry.`);
    }
  }
}
/**
 * K4: Resolves the effective GlobalContext for a specific Selling Point based on its environment mode.
 */
export function withSpEnv(sp: SellingPoint, globalContext: GlobalContext): GlobalContext {
  const mode = sp.envMode || 'global';
  if (mode === 'global') return globalContext;
  if (mode === 'custom' && sp.environmentImage) {
    return { ...globalContext, environmentImage: sp.environmentImage };
  }
  return { ...globalContext, environmentImage: undefined };
}
/**
 * Node One: Global Style Analysis
 */
export async function extractGlobalParams(image: { base64: string; mimeType: string }): Promise<GlobalAnalysis> {
  const systemInstruction = `You are a high-end fashion and product photography consultant.
Analyze this style reference image and extract ONLY these 5 dimensions. Keep each field to 10 English words or fewer.
Output ONLY valid JSON:
{
  "image_type": "Type of image: e.g. product photography, 3D render, lifestyle photo",
  "style_feel": "Overall style: e.g. lifestyle casual, high-tech futuristic, editorial fashion",
  "color_tone": "Color tone: e.g. warm earth tones, cool desaturated blues",
  "lighting": "Lighting approach: e.g. soft wraparound rim light, dramatic side-lit",
  "negative_space": "White/negative space usage: e.g. large left negative space, tight crop"
}`;
  const { text } = await Flow.generate.text("Extract the 5 core visual style dimensions from this reference.", {
    systemInstruction,
    images: [image]
  });
  return safeParseJSON<GlobalAnalysis>(text, "global style analysis");
}
/**
 * Node Two: Visual Extraction
 */
export async function extractVisualParams(sp: SellingPoint, globalContext: GlobalContext): Promise<VisualParams> {
  if (!sp.referenceImage) throw new Error('Missing reference image');
  const productIdentity = globalContext.product_info
    ? `\nCRITICAL — THE PRODUCT BEING ADVERTISED IS: ${globalContext.product_info}\n`
    : '';
  const systemInstruction = `You are a professional commercial photography analyst.
Analyze this reference image to understand the VISUAL STRATEGY.
${productIdentity}
Output ONLY valid JSON with these fields:
{
  "subject": "main subject and visual treatment (≤20 words)",
  "product_presentation": "how the advertised product is staged (≤30 words)",
  "hero_element": "the focal element (≤15 words)",
  "mood_atmosphere": "2-3 emotion words",
  "spatial_relationship": "arrangement and depth layers (≤30 words)",
  "lighting": "lighting setup (≤12 words)",
  "environment": "setting/background only (≤25 words)",
  "composition": "visual flow (≤15 words)",
  "camera_angle": "angle (≤6 words)",
  "shot_scale": "scale (≤6 words)",
  "image_type": "one of: CGI_Abstract, Studio_Minimal, Lifestyle_Commercial, Unknown",
  "requires_model": true or false,
  "model_count": integer (0 if no model),
  "visual_signature_prompt": "visual essence for the final prompt (≤25 words)",
  "color_palette": "dominant colors",
  "material_focus": "texture qualities"
}`;
  const { text } = await Flow.generate.text(
    `Analyze the visual strategy for selling point: "${sp.name}" — "${sp.description}"`,
    {
      systemInstruction,
      images: [{ base64: sp.referenceImage.base64, mimeType: sp.referenceImage.mimeType }]
    }
  );
  return safeParseJSON<VisualParams>(text, "visual extraction");
}
// --- Narrative Helpers (K3: Unified Model Determination Logic) ---
export function spUsesModels(sp: SellingPoint, globalContext: GlobalContext): boolean {
  const available = availableModels(globalContext);
  if (available.length === 0) return false;
  if (sp.modelMode === 'with_model') return true;
  if (sp.modelMode === 'no_model') return false;
  const vp = sp.enrichment.visual_params;
  if (!vp) return true;
  if (typeof vp.requires_model === 'boolean') return vp.requires_model;
  return vp.image_type === 'Lifestyle_Commercial' || vp.image_type === 'Unknown';
}
function availableModels(globalContext: GlobalContext): Array<{ pair: ModelSuitPair, letter: string }> {
  return globalContext.modelReferences
    .map((m, i) => ({ pair: m, letter: String.fromCharCode(65 + i) }))
    .filter(item => item.pair.model || item.pair.suit);
}
export function resolveActiveModelIds(sp: SellingPoint, globalContext: GlobalContext): string[] {
  if (!spUsesModels(sp, globalContext)) return [];
  const available = availableModels(globalContext);
  const availableIds = available.map(a => a.pair.id);
  if (sp.modelMode === 'with_model') {
    const selected = (sp.manualModelIds || []).filter(id => availableIds.includes(id));
    return selected.length > 0 ? selected : availableIds;
  }
  const vp = sp.enrichment.visual_params;
  const rawCount = vp?.model_count ?? 1;
  const count = Math.max(1, Math.min(available.length, Math.round(rawCount)));
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count).map(a => a.pair.id);
  return availableIds.filter(id => picked.includes(id));
}
export function getActiveModels(sp: SellingPoint, globalContext: GlobalContext): Array<{ pair: ModelSuitPair, letter: string }> {
  const isNeeded = spUsesModels(sp, globalContext);
  if (!isNeeded) return [];
  const available = availableModels(globalContext);
  const activeIds = sp.activeModelIds || available.map(a => a.pair.id);
  return available.filter(a => activeIds.includes(a.pair.id));
}
/**
 * K5: Deterministic Reference Builder.
 * This is the SINGLE source of truth for reference order and mediaIds.
 */
export function buildGenerationRefs(sp: SellingPoint, globalContext: GlobalContext): GenRef[] {
  const envContext = withSpEnv(sp, globalContext);
  const refs: GenRef[] = [];
  
  const push = (token: string, noun: string, caption: string, asset?: MediaAsset) => {
    if (!asset) return;
    refs.push({
      index: refs.length + 1,
      token,
      noun,
      caption,
      asset
    });
  };
  // 1. PRODUCT
  push('{{PRODUCT}}', 'the product', 'the advertised product (keep exact shape, logo, proportions)', envContext.productImage);
  // 2. ENVIRONMENT
  push('{{ENV}}', 'the environment', 'environment/scene reference', envContext.environmentImage);
  // 3. MODELS (Iterate through ALL global references to preserve A, B, C letters)
  const activeIds = sp.activeModelIds || [];
  globalContext.modelReferences.forEach((pair, idx) => {
    if (!activeIds.includes(pair.id)) return;
    const letter = String.fromCharCode(65 + idx);
    push(`{{MODEL_${letter}}}`, 'the person', `Model ${letter} face and body (keep identity)`, pair.model);
    push(`{{OUTFIT_${letter}}}`, 'the outfit', `Model ${letter} outfit (clothing, not the product)`, pair.suit);
  });
  return refs.slice(0, 14);
}
/**
 * K5: Resolves prompt tokens to human-readable indices and adds the legend.
 */
function resolveTokensToImageRefs(text: string, refs: GenRef[]): string {
  if (refs.length === 0) {
    return text.replace(/\{\{[A-Z0-9_]+\}\}/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  let processed = text;
  refs.forEach(ref => {
    const replacement = `${ref.noun} from image ${ref.index}`;
    processed = processed.split(ref.token).join(replacement);
  });
  processed = processed.replace(/\{\{[A-Z0-9_]+\}\}/g, '').replace(/\s{2,}/g, ' ').trim();
  const legendItems = refs.map(r => `image ${r.index} = ${r.caption}`);
  const header = `Reference images: ${legendItems.join('; ')}.`;
  return `${header}\n\n${processed}`;
}
/**
 * K6: Inventory now strictly derived from K5 generation references.
 */
function buildInventory(sp: SellingPoint, globalContext: GlobalContext): string[] {
  return buildGenerationRefs(sp, globalContext).map(r => r.token);
}
function extractTokens(n: NarrativeConcept): string[] {
  const text = [n.scene_setting, n.subject_setup, n.props, n.model_choreography || ''].join(' ');
  const matches = text.match(/\{\{[A-Z0-9_]+\}\}/g) || [];
  return Array.from(new Set(matches));
}
function validateTokens(used: string[], inventory: string[]) {
  const invalid = used.filter(t => !inventory.includes(t));
  const missingRequired = (inventory.includes('{{PRODUCT}}') && !used.includes('{{PRODUCT}}'))
    ? ['{{PRODUCT}}'] : [];
  return { invalid, missingRequired };
}
function stripInvalidTokens(text: string, invalid: string[]): string {
  let out = text;
  invalid.forEach(tag => { out = out.split(tag).join(''); });
  return out.replace(/\s{2,}/g, ' ').trim();
}
/**
 * K6: Updated order: Product → Environment → SP Reference → Models
 */
function collectNarrativeImages(sp: SellingPoint, globalContext: GlobalContext): Array<{ base64: string; mimeType: string }> {
  const envContext = withSpEnv(sp, globalContext);
  const images: Array<{ base64: string; mimeType: string }> = [];
  
  if (envContext.productImage) images.push({ base64: envContext.productImage.base64, mimeType: envContext.productImage.mimeType });
  if (envContext.environmentImage) images.push({ base64: envContext.environmentImage.base64, mimeType: envContext.environmentImage.mimeType });
  if (sp.referenceImage) images.push({ base64: sp.referenceImage.base64, mimeType: sp.referenceImage.mimeType });
  
  getActiveModels(sp, globalContext).forEach(({ pair }) => {
    if (pair.model) images.push({ base64: pair.model.base64, mimeType: pair.model.mimeType });
    if (pair.suit) images.push({ base64: pair.suit.base64, mimeType: pair.suit.mimeType });
  });
  return images;
}
/**
 * K6: Updated legend matches collectNarrativeImages order.
 */
function buildImageLegend(sp: SellingPoint, globalContext: GlobalContext): string {
  const envContext = withSpEnv(sp, globalContext);
  const legend: string[] = [];
  let idx = 1;
  
  if (envContext.productImage) { legend.push(`Image ${idx}: {{PRODUCT}} — ADVERTISED PRODUCT.`); idx++; }
  if (envContext.environmentImage) { legend.push(`Image ${idx}: {{ENV}} — ENVIRONMENT REFERENCE.`); idx++; }
  if (sp.referenceImage) { legend.push(`Image ${idx}: SELLING POINT REFERENCE.`); idx++; }
  
  getActiveModels(sp, globalContext).forEach(({ pair, letter }) => {
    if (pair.model) { legend.push(`Image ${idx}: {{MODEL_${letter}}} — Character reference.`); idx++; }
    if (pair.suit) { legend.push(`Image ${idx}: {{OUTFIT_${letter}}} — WARDROBE for Model ${letter}.`); idx++; }
  });
  return legend.join('\n');
}
/**
 * Node 三：Narrative Concept
 */
export async function generateNarrative(
  sp: SellingPoint, 
  globalContext: GlobalContext,
  allSPs: SellingPoint[] = [],
  maxRetries = 2
): Promise<NarrativeConcept> {
  const envContext = withSpEnv(sp, globalContext);
  const visual = sp.enrichment.visual_params!;
  const useModels = spUsesModels(sp, globalContext);
  const activeModels = getActiveModels(sp, globalContext);
  const modelCount = activeModels.length;
  const modelLetters = activeModels.map(x => `Model ${x.letter}`).join(', ');
  const hasEnvImage = !!envContext.environmentImage;
  
  const inventory = buildInventory(sp, globalContext);
  const images = collectNarrativeImages(sp, globalContext);
  const imageLegend = buildImageLegend(sp, globalContext);
  const modelDirectionSection = modelCount > 1 
    ? `MODEL DIRECTION: Since multiple models are featured, you MUST provide a "model_choreography" plan detailing the positioning and interaction of all leads. In subject_setup, focus on their combined interaction with {{PRODUCT}}.\n`
    : modelCount === 1
    ? `MODEL DIRECTION: Since 1 model is featured, describe their body pose, gaze, and interaction with {{PRODUCT}} in detail within subject_setup.\n`
    : '';
  const noModelSection = !useModels ? `
NO HUMAN MODEL: This selling point's image type (${visual.image_type}) is product-focused. Do NOT include any person, hands, or body parts. Focus entirely on the product and its staging.
` : '';
  const castSection = modelCount > 0 ? `
CAST: The featured (lead) people are ${modelLetters}. Only they use model tokens and keep their reference identity. If the scene naturally needs more people (e.g. party, crowd, group activity), you MAY add unnamed extras described generically (no tokens), keeping the leads and {{PRODUCT}} as the focus.
` : '';
  
  const buildSystemInstruction = (correction?: string) => {
    return `You are a Creative Director designing a scene.
Study the attached images carefully.
${imageLegend}
PRODUCT: ${globalContext.product_info || '{{PRODUCT}}'}
SELLING POINT: "${sp.name}" - ${sp.description}
AVAILABLE ASSETS (Use ONLY these tags):
${inventory.join(', ')}
${modelDirectionSection}${castSection}${noModelSection}
BRAND CONTEXT:
${globalContext.brand_tone || 'Standard high-end commercial style.'}
RULES:
1. {{PRODUCT}} must be the hero.
2. If models are present, keep their interaction realistic and brand-appropriate.
3. scene_setting = background ONLY.
4. subject_setup = detailed product/model interaction.
5. If no model is used, subject_setup MUST NOT contain any people, hands, or body parts.
${correction ? `\nCORRECTION: ${correction}` : ''}
Output ONLY valid JSON:
{
  "scene_setting": "environment string",
  "subject_setup": "interaction string",
  "props": "props string",
  "emotion_keywords": ["word1", "word2"],
  "model_choreography": "full staging plan (required if models > 1)"
}`;
  };
  
  let correction: string | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { text } = await Flow.generate.text(`Narrative for: ${sp.name}`, { 
      systemInstruction: buildSystemInstruction(correction),
      images: images.length > 0 ? images : undefined
    });
    const narrative = await safeParseJSON<NarrativeConcept>(text, "narrative concept");
    const used = extractTokens(narrative);
    const { invalid, missingRequired } = validateTokens(used, inventory);
    if (invalid.length === 0 && missingRequired.length === 0) return narrative;
    correction = `Undeclared tags used: ${invalid.join(', ')}`;
    if (attempt === maxRetries) {
      narrative.subject_setup = stripInvalidTokens(narrative.subject_setup, invalid);
      narrative._autoCorrected = true;
      return narrative;
    }
  }
  throw new Error('Narrative failed');
}
/**
 * Node 四：Prompt Assembly Compiler
 */
export function compilePrompt(sp: SellingPoint, globalContext: GlobalContext): string {
  const v = sp.enrichment.visual_params!;
  const n = sp.enrichment.narrative_concept!;
  const g = globalContext.global_analysis;
  const productBlock = `[PRODUCT]\n${globalContext.product_info || 'Product'}, ${sp.name}\n${v.product_presentation}`;
  
  const blockTitle = spUsesModels(sp, globalContext) ? 'MODEL & COMPOSITION' : 'SUBJECT & COMPOSITION';
  const modelBlock = `[${blockTitle}]\n${n.subject_setup}${n.model_choreography ? `\n${n.model_choreography}` : ''}\n${v.composition}, ${v.camera_angle}, Hero: ${v.hero_element}`;
  
  const sceneBlock = `[SCENE]\n${n.scene_setting}\nProps: ${n.props}. Emotion: ${n.emotion_keywords.join(', ')}.`;
  
  const styleDimensions = g 
    ? `Type: ${g.image_type} | Style: ${g.style_feel} | Tone: ${g.color_tone} | Light: ${g.lighting}`
    : `Type: ${v.image_type} | Light: ${v.lighting}${v.color_palette ? ` | Tone: ${v.color_palette}` : ''}`;
  
  const styleBlock = `[STYLE]\n${styleDimensions}`;
  const aspectNote = `Aspect ratio ${parseAspectRatio(globalContext.output_spec)}.`;
  
  const raw = [productBlock, modelBlock, sceneBlock, styleBlock, aspectNote].join('\n\n');
  
  // K5: Resolve tokens to indices based on deterministic buildGenerationRefs
  const refs = buildGenerationRefs(sp, globalContext);
  return resolveTokensToImageRefs(raw, refs).slice(0, 3600);
}
export function parseAspectRatio(spec: string): '1:1' | '16:9' | '9:16' | '4:3' | '3:4' {
  const ratios: (['1:1', '16:9', '9:16', '4:3', '3:4']) = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  for (const r of ratios) { if (spec.includes(r)) return r as any; }
  return '16:9';
}
