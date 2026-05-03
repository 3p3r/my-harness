export const FLEET_ENDPOINTS = {
  deez1_8010: {
    url: "http://192.168.1.95:8010/v1",
    model: "Qwen/Qwen3.6-35B-A3B",
    type: "qwen36",
    chatTemplateKwargs: { enable_thinking: false },
  },
  deez2_8000: {
    url: "http://192.168.1.114:8000/v1",
    model: "TrevorJS/gemma-4-26B-A4B-it-uncensored",
    type: "gemma4",
    chatTemplateKwargs: { enable_thinking: false },
  },
  deez2_8001: {
    url: "http://192.168.1.114:8001/v1",
    model: "TrevorJS/gemma-4-26B-A4B-it-uncensored",
    type: "gemma4",
    chatTemplateKwargs: { enable_thinking: false },
  },
  deezx_8000: {
    url: "http://192.168.1.161:8000/v1",
    model: "Qwen/Qwen3.6-27B",
    type: "qwen36",
    chatTemplateKwargs: { enable_thinking: false },
  },
  deezx_8001: {
    url: "http://192.168.1.161:8001/v1",
    model: "Qwen/Qwen3.6-27B",
    type: "qwen36",
    chatTemplateKwargs: { enable_thinking: false },
  },
} as const;

export type FleetEndpoint =
  (typeof FLEET_ENDPOINTS)[keyof typeof FLEET_ENDPOINTS];
