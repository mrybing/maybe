export type ImageType = 'CGI_Abstract' | 'Studio_Minimal' | 'Lifestyle_Commercial' | 'Unknown';
export interface VisualParams {
  subject: string;
  lighting: string;
  environment: string;
  composition: string;
  camera_angle: string;
  shot_scale: string;
  image_type: ImageType;
  visual_signature_prompt: string;
  color_palette?: string;
  material_focus?: string;
}
export interface GlobalAnalysis {
  style_description: string;
  lighting_mood: string;
  color_strategy: string;
}
export interface NarrativeConcept {
  scene_setting: string;
  subject_setup: string;
  props: string;
  copywriting: {
    headline: string;
    sub_headline: string;
  };
  emotion_keywords: string[];
  _autoCorrected?: boolean; // Tracking if invalid tokens were stripped
}
export interface MediaAsset {
  mediaId: string;
  base64: string;
  mimeType: string;
  name?: string;
}
export interface ModelSuitPair {
  id: string;
  model?: MediaAsset;
  suit?: MediaAsset;
}
export interface SellingPoint {
  sp_id: string;
  name: string;
  description: string;
  referenceImage?: MediaAsset;
  enrichment: {
    visual_params: VisualParams | null;
    narrative_concept: NarrativeConcept | null;
    final_prompt: string | null;
    generatedImage?: MediaAsset;
  };
  status: 'idle' | 'analyzing' | 'narrating' | 'compiling' | 'awaiting_review' | 'generating' | 'completed' | 'error';
  error?: string;
}
export interface GlobalContext {
  product_info: string;
  brand_tone: string;
  output_spec: string;
  globalStyleImage?: MediaAsset;
  productImage?: MediaAsset;
  environmentImage?: MediaAsset;
  modelReferences: ModelSuitPair[];
  global_analysis?: GlobalAnalysis | null;
}
export interface ProductCampaignState {
  global_context: GlobalContext;
  selling_points: SellingPoint[];
}
