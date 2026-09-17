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
 */
export async function extractVisualParams(sp: SellingPoint, globalStyle?: GlobalAnalysis | null): Promise<VisualParams> {
  if (!sp.referenceImage) throw new Error('Missing reference image');
  const globalContextNote = globalStyle 
    ? `Global Style Context: ${globalStyle.style_description}. Lighting: ${globalStyle.lighting_mood}.`
    : "";
  const systemInstruction = `You are a professional commercial photography analyst. 
Analyze the reference image and extract visual parameters. 
${globalContextNote}
CRITICAL RULE: Focus ONLY on technical execution (how it's shot). Do NOT describe the specific person or product in the image.
Output ONLY valid JSON.`;
  const { text } = await Flow.generate.text(`Analyze visual parameters for: "${sp.name}".`, {
    systemInstruction,
    images: [{ base64: sp.referenceImage.base64, mimeType: sp.referenceImage.mimeType }]
  });
  return safeParseJSON<VisualParams>(text, "visual extraction");
}
// --- Narrative Helpers ---
function buildInventory(globalContext: GlobalContext): string[] {
  const inventory: string[] = [];
  if (globalContext.productImage) inventory.push("{{PRODUCT}}");
  if (globalContext.environmentImage) inventory.push("{{ENV}}");
  if (globalContext.globalStyleImage) inventory.push("{{STYLE}}"); // Fixed: Included Style reference
  globalContext.modelReferences.forEach((m, i) => {
    const letter = String.fromCharCode(65 + i);
    if (m.model) inventory.push(`{{MODEL_${letter}}}`);
    if (m.suit) inventory.push(`{{OUTFIT_${letter}}}`);
  });
  return inventory;
}
function extractTokens(n: NarrativeConcept): string[] {
  const text = [n.scene_setting, n.subject_setup, n.props].join(' ');
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
 * Node 三：Asset-Aware Narrative Concept Node (叙事构思)
 * Robust version with inventory validation and correction loop.
 */
export async function generateNarrative(
  sp: SellingPoint, 
  globalContext: GlobalContext,
  maxRetries = 2
): Promise<NarrativeConcept> {
  const visual = sp.enrichment.visual_params!;
  const aspectRatio = parseAspectRatio(globalContext.output_spec);
  const inventory = buildInventory(globalContext);
  const buildSystemInstruction = (correction?: string) => `You are a Creative Director for a high-end agency.
Brand Tone: ${globalContext.brand_tone || "Premium and Editorial"}
Target畫幅: ${aspectRatio}
RULES:
1. MATERIAL AVAILABILITY: Only use tags from this list: ${inventory.join(', ')}. Do NOT invent models, styles, or environments not listed. Copy tags EXACTLY.
2. If {{PRODUCT}} is available, it MUST appear in subject_setup or scene_setting.
3. FIDELITY: Do not alter the product's shape, logo, or proportions. Describe the narrative *around* {{PRODUCT}}.
4. SPATIAL LOGIC: For ${aspectRatio}, ensure scene_setting accounts for ${aspectRatio === '16:9' ? 'horizontal sweep and background depth' : 'vertical focus and headroom'}.
5. IMAGE MODE: ${visual.image_type}. If CGI_Abstract, avoid naturalistic human actions.
${correction ? `\nCORRECTION NEEDED: ${correction}\nRewrite strictly following rule 1.` : ''}
Output ONLY valid JSON with fields: scene_setting, subject_setup, props, copywriting (headline, sub_headline), emotion_keywords (array).`;
  const prompt = `Product: ${globalContext.product_info}
Selling Point: ${sp.name} - ${sp.description}
Style Reference: ${globalContext.global_analysis?.style_description || ''}`;
  let correction: string | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { text } = await Flow.generate.text(prompt, { systemInstruction: buildSystemInstruction(correction) });
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
 */
export function compilePrompt(sp: SellingPoint, globalContext: GlobalContext): string {
  const v = sp.enrichment.visual_params!;
  const n = sp.enrichment.narrative_concept!;
  const g = globalContext.global_analysis;
  
  let stylePrefix = "Commercial advertising photography";
  if (v.image_type === 'CGI_Abstract') {
    stylePrefix = "High-end 3D render, CGI art, physically-based rendering, octane render style";
  } else if (v.image_type === 'Studio_Minimal') {
    stylePrefix = "Commercial product studio photography, clean minimal styling, high-key";
  } else if (v.image_type === 'Lifestyle_Commercial') {
    stylePrefix = "Lifestyle commercial photography, editorial realism, cinematic location";
  }
  const globalBase = g ? `Global Mood: ${g.lighting_mood}. Strategy: ${g.color_strategy}. ` : '';
  
  const part1 = `${stylePrefix}, ${globalBase} aspect ratio ${parseAspectRatio(globalContext.output_spec)}.`;
  const part2 = `Subject Layout: ${v.subject}. Narrative: ${n.subject_setup}. Environment: ${v.environment}. ${n.scene_setting}. Props: ${n.props}.`;
  const part3 = `Visual Signature: ${v.visual_signature_prompt}. ${v.lighting} lighting, ${v.composition} composition, ${v.shot_scale} shot, ${v.camera_angle} angle.`;
  const part4 = `Technical focus: ${v.material_focus ? `Material: ${v.material_focus}. ` : ''}${v.color_palette ? `Palette: ${v.color_palette}.` : ''}`;
  return [part1, part2, part3, part4].join('\n');
}
export function parseAspectRatio(spec: string): '1:1' | '16:9' | '9:16' | '4:3' | '3:4' {
  const ratios: (['1:1', '16:9', '9:16', '4:3', '3:4']) = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  for (const r of ratios) {
    if (spec.includes(r)) return r as any;
  }
  return '16:9';
}
