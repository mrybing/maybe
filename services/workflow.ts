import { Flow } from 'flow-sdk';
import { SellingPoint, GlobalContext, VisualParams, NarrativeConcept, GlobalAnalysis } from '../types';
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
 * Node One: Global Style Analysis
 * 
 * Unchanged — this node is already appropriate.
 * It extracts abstract style DNA from a reference image without over-asserting.
 */
export async function extractGlobalParams(image: { base64: string; mimeType: string }): Promise<GlobalAnalysis> {
  const systemInstruction = `You are a high-end fashion and product photography consultant. 
Extract the visual essence of this style reference. Focus on lighting strategy, color palette, and texture rendering.
Output ONLY valid JSON with fields: style_description, lighting_mood, color_strategy.`;
  const { text } = await Flow.generate.text("Extract core visual DNA.", {
    systemInstruction,
    images: [image]
  });
  return safeParseJSON<GlobalAnalysis>(text, "global style analysis");
}
/**
 * Node 二：Visual Extraction (视觉参数提取)
 * 
 * FIXES APPLIED:
 * 1. REMOVED globalContextNote injection — selling point reference analysis must be independent,
 *    not biased by the global style.
 * 2. REMOVED "CRITICAL RULE: Do NOT describe the specific person or product" — this was
 *    stripping the most valuable information from the selling point reference.
 * 3. ADDED new extraction fields: product_presentation, hero_element, mood_atmosphere,
 *    spatial_relationship — these capture the INTENT of the reference, not just technical params.
 * 4. Rewritten prompt to prioritize understanding HOW the selling point is visually communicated.
 */
export async function extractVisualParams(sp: SellingPoint, globalContext: GlobalContext): Promise<VisualParams> {
  if (!sp.referenceImage) throw new Error('Missing reference image');
  // product_info tells the LLM what the ACTUAL product is (e.g. "wireless earbuds"),
  // so it won't mistake clothing or other elements for the product.
  const productIdentity = globalContext.product_info
    ? `\nCRITICAL — THE PRODUCT BEING ADVERTISED IS: ${globalContext.product_info}\nWhen analyzing "product presentation" and "hero element", focus on THIS product specifically.\nOther items in the image (clothing, accessories worn by models, furniture, etc.) are NOT the product — they are props or styling.\n`
    : '';
  const systemInstruction = `You are a professional commercial photography analyst.
Analyze this reference image to understand the VISUAL STRATEGY for communicating a selling point.
${productIdentity}
ANALYSIS PRIORITIES (in order):
1. PRODUCT PRESENTATION — How is the advertised product${globalContext.product_info ? ` (${globalContext.product_info})` : ''} showcased? What makes it stand out? Describe the presentation strategy (e.g. "product floating at center with dramatic rim light", "product held by model at eye-level, intimate close-up").
2. HERO ELEMENT — What is the single most dominant visual element? What draws the eye first?
3. MOOD & ATMOSPHERE — What emotion does this image convey? What is the overall feeling?
4. SPATIAL RELATIONSHIP — How are elements arranged relative to each other? Foreground/background/layering.
5. TECHNICAL EXECUTION — Lighting setup, camera angle, lens characteristics, composition framework.
You MAY and SHOULD describe the product and how it appears in the image.
Do NOT describe specific human faces in detail (but body position, gesture, and styling are fine).
Output ONLY valid JSON with these fields:
{
  "subject": "main subject description and its visual treatment",
  "product_presentation": "how the advertised product${globalContext.product_info ? ` (${globalContext.product_info})` : ''} is staged, positioned, and emphasized — NOT other items like clothing",
  "hero_element": "the single most dominant visual element in the frame",
  "mood_atmosphere": "the emotional tone and atmospheric quality",
  "spatial_relationship": "arrangement of elements, depth layers, foreground/background relationship",
  "lighting": "lighting setup and quality",
  "environment": "setting/background description",
  "composition": "composition framework and visual flow",
  "camera_angle": "camera angle",
  "shot_scale": "shot scale (close-up, medium, wide, etc.)",
  "image_type": "one of: CGI_Abstract, Studio_Minimal, Lifestyle_Commercial, Unknown",
  "visual_signature_prompt": "a concise prompt fragment that captures the ESSENCE of this visual approach",
  "color_palette": "dominant and accent colors",
  "material_focus": "key material/texture qualities visible"
}`;
  const { text } = await Flow.generate.text(
    `Analyze the visual strategy in this reference image for selling point: "${sp.name}" — "${sp.description}".${globalContext.product_info ? ` The product being advertised is: ${globalContext.product_info}.` : ''}`,
    {
      systemInstruction,
      images: [{ base64: sp.referenceImage.base64, mimeType: sp.referenceImage.mimeType }]
    }
  );
  return safeParseJSON<VisualParams>(text, "visual extraction");
}
// --- Narrative Helpers ---
function buildInventory(globalContext: GlobalContext): string[] {
  const inventory: string[] = [];
  if (globalContext.productImage) inventory.push("{{PRODUCT}}");  // The actual product being advertised
  if (globalContext.environmentImage) inventory.push("{{ENV}}");
  // NOTE: {{STYLE}} removed from inventory — global style should influence tone, not be placed in scene.
  globalContext.modelReferences.forEach((m, i) => {
    const letter = String.fromCharCode(65 + i);
    if (m.model) inventory.push(`{{MODEL_${letter}}}`);        // Model's face/body for character consistency
    if (m.suit) inventory.push(`{{OUTFIT_${letter}}}`);        // Model's WARDROBE — NOT the advertised product
  });
  return inventory;
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
 * Collect all images that should be passed to generateNarrative for the LLM to see.
 * This includes: product image, selling point reference, model images, outfit images.
 * The LLM needs to SEE these to direct the scene properly.
 */
function collectNarrativeImages(sp: SellingPoint, globalContext: GlobalContext): Array<{ base64: string; mimeType: string }> {
  const images: Array<{ base64: string; mimeType: string }> = [];
  // 1. Product image — if available
  if (globalContext.productImage) {
    images.push({ base64: globalContext.productImage.base64, mimeType: globalContext.productImage.mimeType });
  }
  // 2. Selling point reference — LLM should SEE this to understand the visual approach
  //    (it won't be passed to the generation model — only text structure goes there)
  if (sp.referenceImage) {
    images.push({ base64: sp.referenceImage.base64, mimeType: sp.referenceImage.mimeType });
  }
  // 3. Model reference images — LLM must see what the models look like to direct them properly
  globalContext.modelReferences.forEach(m => {
    if (m.model) images.push({ base64: m.model.base64, mimeType: m.model.mimeType });
    if (m.suit) images.push({ base64: m.suit.base64, mimeType: m.suit.mimeType });
  });
  return images;
}
/**
 * Build an image legend for the LLM, describing what each attached image represents.
 */
function buildImageLegend(sp: SellingPoint, globalContext: GlobalContext): string {
  const legend: string[] = [];
  let idx = 1;
  if (globalContext.productImage) {
    const productName = globalContext.product_info ? ` (${globalContext.product_info})` : '';
    legend.push(`Image ${idx}: {{PRODUCT}}${productName} — THE PRODUCT BEING ADVERTISED. This MUST be the visual hero and prominently featured. Everything else in the scene serves THIS product.`);
    idx++;
  }
  if (sp.referenceImage) {
    legend.push(`Image ${idx}: SELLING POINT REFERENCE — This shows the desired VISUAL APPROACH. Reproduce this style, composition, and product presentation strategy. This is your most important visual guide.`);
    idx++;
  }
  globalContext.modelReferences.forEach((m, i) => {
    const letter = String.fromCharCode(65 + i);
    if (m.model) {
      legend.push(`Image ${idx}: {{MODEL_${letter}}} — Character reference. Maintain this person's appearance exactly.`);
      idx++;
    }
    if (m.suit) {
      legend.push(`Image ${idx}: {{OUTFIT_${letter}}} — WARDROBE for Model ${letter} (what this model wears). This is NOT the advertised product — it is the model's clothing/styling.`);
      idx++;
    }
  });
  return legend.join('\n');
}
/**
 * Node 三：Asset-Aware Narrative Concept Node (叙事构思)
 *
 * FIXES APPLIED:
 * 1. Brand tone DEMOTED from "PARAMOUNT" → "REFERENCE CONTEXT" (was Problem 1)
 * 2. Selling point promoted to "PRIMARY DIRECTIVE" — it IS the most important input
 * 3. All visual params now used (was only 3/10 fields → now all fields)
 * 4. Selling point reference image + model images now passed to LLM (was Problem 2 & 3)
 * 5. Added image legend so LLM knows what each image represents
 * 6. allSPs context now used for cross-selling-point consistency (was Problem 4)
 * 7. Copywriting generation removed — pure image mode (user requirement)
 * 8. Added multi-model choreography when multiple models exist (was Problem 2)
 * 9. Token extraction now also checks model_choreography field
 */
export async function generateNarrative(
  sp: SellingPoint, 
  globalContext: GlobalContext,
  allSPs: SellingPoint[] = [],
  maxRetries = 2
): Promise<NarrativeConcept> {
  const visual = sp.enrichment.visual_params!;
  const aspectRatio = parseAspectRatio(globalContext.output_spec);
  const inventory = buildInventory(globalContext);
  const images = collectNarrativeImages(sp, globalContext);
  const imageLegend = buildImageLegend(sp, globalContext);
  
  // Count models for choreography section
  const modelCount = globalContext.modelReferences.filter(m => m.model).length;
  
  // Build cross-SP context (use narratives from already-processed SPs)
  const otherSPContext = allSPs
    .filter(s => s.sp_id !== sp.sp_id && s.enrichment.narrative_concept)
    .map(s => `- "${s.name}": ${s.enrichment.narrative_concept!.scene_setting}`)
    .join('\n');
  const buildSystemInstruction = (correction?: string) => {
    const modelChoreographySection = modelCount > 1 ? `
MULTI-MODEL CHOREOGRAPHY:
- You have ${modelCount} models available. Each model MUST serve a distinct narrative role.
- Describe spatial relationships between models explicitly (who stands where, who interacts with what).
- The PRIMARY model interacts with or presents the product.
- SECONDARY models provide lifestyle context, emotional framing, or scale reference.
- Models must NEVER compete with the product for visual attention.
- Output a "model_choreography" field describing each model's position, pose, and role.
` : modelCount === 1 ? `
SINGLE MODEL DIRECTION:
- The model should naturally interact with or complement the product.
- The model's role is to provide HUMAN CONTEXT — showing how the product fits into life.
- Product remains the hero; the model is a supporting element.
` : '';
    const crossSPSection = otherSPContext ? `
OTHER SCENES IN THIS CAMPAIGN (for visual consistency reference):
${otherSPContext}
Maintain visual consistency with these scenes while keeping this selling point's focus distinct.
` : '';
    return `You are a Creative Director designing a scene for premium product photography.
You will receive reference images — study them carefully before writing.
ATTACHED IMAGES:
${imageLegend}
═══════════════════════════════════════════
PRODUCT IDENTITY — WHAT WE ARE ADVERTISING:
${globalContext.product_info || 'See {{PRODUCT}} image'}
This is the ONLY product being promoted. All other items (model clothing, furniture, etc.) are props/styling.
═══════════════════════════════════════════
PRIMARY DIRECTIVE — SELLING POINT (This is your #1 priority):
Name: "${sp.name}"
Description: "${sp.description}"
SELLING POINT VISUAL APPROACH (extracted from the reference image — REPRODUCE this approach):
- Product Presentation: ${visual.product_presentation}
- Hero Element: ${visual.hero_element}
- Mood & Atmosphere: ${visual.mood_atmosphere}
- Spatial Arrangement: ${visual.spatial_relationship}
- Subject: ${visual.subject}
- Lighting: ${visual.lighting}
- Environment: ${visual.environment}
- Composition: ${visual.composition}
- Camera: ${visual.camera_angle}, ${visual.shot_scale}
- Visual Signature: ${visual.visual_signature_prompt}
${visual.color_palette ? `- Color Palette: ${visual.color_palette}` : ''}
${visual.material_focus ? `- Material Focus: ${visual.material_focus}` : ''}
Target Aspect Ratio: ${aspectRatio}
Image Mode: ${visual.image_type}${visual.image_type === 'CGI_Abstract' ? ' — avoid naturalistic human actions, use abstract/surreal staging' : ''}
AVAILABLE VISUAL ASSETS (Use ONLY these exact tokens):
${inventory.join(', ')}
TOKEN SEMANTICS:
- {{PRODUCT}} = the advertised product${globalContext.product_info ? ` (${globalContext.product_info})` : ''}. This is what we are selling.
- {{MODEL_X}} = a human model for character consistency. They are NOT the product.
- {{OUTFIT_X}} = the model's WARDROBE/CLOTHING. This is what the model WEARS. It is NOT the advertised product.
- {{ENV}} = environment/location plate.
${modelChoreographySection}
BRAND CONTEXT (reference only — do NOT let this override the selling point direction):
Tone: ${globalContext.brand_tone || 'Premium'}
${crossSPSection}
RULES:
1. MATERIAL AVAILABILITY: Only use tags from the AVAILABLE VISUAL ASSETS list. Copy tags EXACTLY as written.
2. If {{PRODUCT}} is available, it MUST appear prominently in subject_setup or scene_setting. The product is ${globalContext.product_info || '{{PRODUCT}}'}, NOT model clothing.
3. FIDELITY: Do not alter the product's shape, logo, or proportions.
4. SPATIAL LOGIC: For ${aspectRatio}, ensure scene_setting accounts for ${aspectRatio === '16:9' ? 'horizontal sweep and background depth' : aspectRatio === '9:16' ? 'vertical focus and headroom' : 'balanced framing'}.
5. The scene MUST directly serve the selling point "${sp.name}" — every element should reinforce why this selling point matters visually.
6. REPRODUCE the visual approach from the selling point reference image: match its composition strategy, product staging, and mood.
7. PRODUCT vs OUTFIT DISTINCTION: {{OUTFIT_X}} is the model's clothing — it is a styling prop, NOT the product. The advertised product is ONLY {{PRODUCT}}${globalContext.product_info ? ` (${globalContext.product_info})` : ''}. Never treat outfits as the hero product.
${correction ? `\nCORRECTION NEEDED: ${correction}\nRewrite strictly following rule 1.` : ''}
Output ONLY valid JSON with fields:
- scene_setting (string): The environment and context of the scene
- subject_setup (string): How the main subject(s) and the advertised product${globalContext.product_info ? ` (${globalContext.product_info})` : ''} are arranged
- props (string): Supporting elements and details
- emotion_keywords (string[]): 3-5 emotional descriptors${modelCount > 1 ? '\n- model_choreography (string): Detailed spatial direction for each model' : ''}`;
  };
  
  const prompt = `Design a scene that powerfully communicates this selling point: "${sp.name}" — ${sp.description}`;
  
  let correction: string | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { text } = await Flow.generate.text(prompt, { 
      systemInstruction: buildSystemInstruction(correction),
      images: images.length > 0 ? images : undefined
    });
    const narrative = await safeParseJSON<NarrativeConcept>(text, "narrative concept");
    const used = extractTokens(narrative);
    const { invalid, missingRequired } = validateTokens(used, inventory);
    if (invalid.length === 0 && missingRequired.length === 0) {
      return narrative;
    }
    if (attempt === maxRetries) {
      // Final fallback: Strip invalid tokens and mark as auto-corrected
      narrative.subject_setup = stripInvalidTokens(narrative.subject_setup, invalid);
      narrative.scene_setting = stripInvalidTokens(narrative.scene_setting, invalid);
      narrative.props = stripInvalidTokens(narrative.props, invalid);
      if (narrative.model_choreography) {
        narrative.model_choreography = stripInvalidTokens(narrative.model_choreography, invalid);
      }
      narrative._autoCorrected = invalid.length > 0;
      return narrative;
    }
    correction = [
      invalid.length ? `You used undeclared tags: ${invalid.join(', ')}.` : '',
      missingRequired.length ? `You forgot required tag(s): ${missingRequired.join(', ')}.` : ''
    ].filter(Boolean).join(' ');
  }
  throw new Error('Unreachable: Narrative loop failed');
}
/**
 * Node 四：Prompt Assembly Compiler
 *
 * FIXES APPLIED:
 * 1. SELLING POINT is now the FIRST and LARGEST block (~40% of prompt) — was last at ~10%
 * 2. Brand context MOVED to end and CONDENSED to a single-line context note (~5%)
 * 3. Global style MOVED to end and CONDENSED (~5%)
 * 4. REMOVED content duplication (color_strategy no longer appears twice)
 * 5. Added model choreography block when multi-model
 * 6. Visual execution merged into a single coherent block
 * 7. Copywriting/typography block removed (pure image mode)
 * 8. Overall proportion: Selling Point ~40%, Scene ~25%, Technical ~25%, Global/Brand ~10%
 * 
 * NOTE ON IMAGE STRATEGY:
 * - Selling point reference images are NOT passed to the generation model (to avoid visual copying)
 * - Only product, environment, model, and outfit images are passed via referenceImageMediaIds
 * - The selling point's visual intent is conveyed purely through text (extracted by extractVisualParams)
 */
export function compilePrompt(sp: SellingPoint, globalContext: GlobalContext): string {
  const v = sp.enrichment.visual_params!;
  const n = sp.enrichment.narrative_concept!;
  const g = globalContext.global_analysis;
  
  // --- Style prefix based on image type ---
  let stylePrefix = "Commercial advertising photography";
  if (v.image_type === 'CGI_Abstract') {
    stylePrefix = "High-end 3D render, CGI art, physically-based rendering, octane render style";
  } else if (v.image_type === 'Studio_Minimal') {
    stylePrefix = "Commercial product studio photography, clean minimal styling, high-key";
  } else if (v.image_type === 'Lifestyle_Commercial') {
    stylePrefix = "Lifestyle commercial photography, editorial realism, cinematic location";
  }
  // --- BLOCK 1: SELLING POINT (HERO BLOCK — most prominent, most detailed) ---
  const productLine = globalContext.product_info ? `Product: ${globalContext.product_info}\n` : '';
  const sellingPointBlock = `[SELLING POINT — PRIMARY FOCUS: "${sp.name}"]
${productLine}${sp.description}
Product Presentation: ${v.product_presentation}
Hero Element: ${v.hero_element}
Mood: ${v.mood_atmosphere}
Visual Approach: ${v.visual_signature_prompt}`;
  // --- BLOCK 2: SCENE DIRECTION (from narrative) ---
  let sceneBlock = `[SCENE]
${n.scene_setting}. ${n.subject_setup}.
Props: ${n.props}.
Emotion: ${n.emotion_keywords.join(', ')}.`;
  // --- BLOCK 2b: MODEL CHOREOGRAPHY (if multi-model) ---
  if (n.model_choreography) {
    sceneBlock += `\nModel Direction: ${n.model_choreography}`;
  }
  // --- BLOCK 3: VISUAL EXECUTION (merged technical params — no duplication) ---
  const technicalParts = [
    `${stylePrefix}`,
    `${v.lighting} lighting, ${v.camera_angle} angle, ${v.shot_scale} shot`,
    `${v.composition} composition`,
    `Spatial: ${v.spatial_relationship}`,
    `Environment: ${v.environment}`,
  ];
  if (v.material_focus) technicalParts.push(`Material: ${v.material_focus}`);
  if (v.color_palette) technicalParts.push(`Palette: ${v.color_palette}`);
  const technicalBlock = `[VISUAL EXECUTION]\n${technicalParts.join('. ')}.`;
  // --- BLOCK 4: CONTEXT (brand + global — minimal, at the end) ---
  const contextParts: string[] = [];
  if (globalContext.brand_tone) contextParts.push(`Brand tone: ${globalContext.brand_tone}`);
  if (g) contextParts.push(`Style ref: ${g.lighting_mood}, ${g.color_strategy}`);
  const contextBlock = contextParts.length > 0 
    ? `[CONTEXT]\n${contextParts.join('. ')}.`
    : '';
  // --- ASSEMBLE: Selling Point → Scene → Technical → Context ---
  const aspectNote = `Aspect ratio ${parseAspectRatio(globalContext.output_spec)}.`;
  const blocks = [sellingPointBlock, sceneBlock, technicalBlock, contextBlock, aspectNote]
    .filter(b => b.length > 0);
  return blocks.join('\n\n');
}
export function parseAspectRatio(spec: string): '1:1' | '16:9' | '9:16' | '4:3' | '3:4' {
  const ratios: (['1:1', '16:9', '9:16', '4:3', '3:4']) = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  for (const r of ratios) {
    if (spec.includes(r)) return r as any;
  }
  return '16:9';
}
