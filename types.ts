export type ImageType = 'CGI_Abstract' | 'Studio_Minimal' | 'Lifestyle_Commercial' | 'Unknown';
export interface VisualParams {
  subject: string;
  lighting: string;
  environment: string;
  composition: string;
  camera_angle: string;
  shot_scale: string;
  image_type: ImageType;
  requires_model: boolean;   // 成品图是否应该出现真人
  model_count?: number;      // 成品图需要几位「主角」人物；requires_model 为 false 时为 0
  visual_signature_prompt: string;
  color_palette?: string;
  material_focus?: string;
  // --- New: fields to better capture selling point visual intent ---
  product_presentation: string;   // How the product is showcased/positioned/emphasized
  hero_element: string;           // The visual focal point of the image
  mood_atmosphere: string;        // Emotional tone and atmosphere
  spatial_relationship: string;   // Spatial arrangement between elements
}
export interface GlobalAnalysis {
  image_type: string;     // 类型: 渲染图 / 摄影图 / 白底图 etc.
  style_feel: string;     // 风格: 生活照 / 科技感 / 商业大片 etc.
  color_tone: string;     // 色调
  lighting: string;       // 光影
  negative_space: string; // 留白空间
}
export interface NarrativeConcept {
  scene_setting: string;
  subject_setup: string;
  props: string;
  // copywriting removed — pure image generation, no text overlay
  emotion_keywords: string[];
  model_choreography?: string;    // New: multi-model staging directions when models are present
  _autoCorrected?: boolean;       // Tracking if invalid tokens were stripped
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
  modelMode?: 'auto' | 'with_model' | 'no_model';  // auto=由 Node2 决定人数并随机抽人；with_model=手动勾选；no_model=纯产品
  manualModelIds?: string[];   // modelMode=with_model 时勾选的 modelReferences id；空/未定义 = 全部
  activeModelIds?: string[];   // Process 时固化的「实际使用模特」id，后续所有环节的唯一依据
  envMode?: 'global' | 'custom' | 'none';  // 环境图作用域：用全局环境图(默认) / 用本卖点自己的 / 不用
  environmentImage?: MediaAsset;           // 本卖点自己的环境图，仅 envMode='custom' 时使用
  enrichment: {
    visual_params: VisualParams | null;
    narrative_concept: NarrativeConcept | null;
    final_prompt: string | null;
    generatedImage?: MediaAsset;
  };
  status: 'idle' | 'analyzing' | 'narrating' | 'compiling' | 'awaiting_review' | 'generating' | 'completed' | 'error';
  error?: string;
}
export interface ModelReference {
  model?: { base64: string; mimeType: string };
  suit?: { base64: string; mimeType: string };
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
