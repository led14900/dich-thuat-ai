/**
 * provider-utils.js — Shared helpers for resolving the active AI provider
 *
 * Provider-specific settings live in their own sub-object (vertexAI / geminiAPI /
 * openaiCompatible), while `settings.model` is only a legacy global fallback.
 * Every caller that needs "which model is actually active?" must go through
 * resolveProviderModel() so adding a provider stays a one-place change.
 */
window.ProviderUtils = (() => {

  const PROVIDER_META = {
    'vertex-ai': { label: 'Gemini Enterprise', color: '#c8502d', configKey: 'vertexAI' },       // brand terracotta
    'gemini-api': { label: 'Gemini API', color: '#f97316', configKey: 'geminiAPI' },            // orange
    'openai-compatible': { label: 'OpenAI Compatible', color: '#10a37f', configKey: 'openaiCompatible' }, // teal
  };

  const DEFAULT_PROVIDER = 'vertex-ai';

  function getProviderId(settings) {
    const id = settings?.aiProvider;
    return PROVIDER_META[id] ? id : DEFAULT_PROVIDER;
  }

  function getProviderMeta(settings) {
    return PROVIDER_META[getProviderId(settings)];
  }

  /**
   * Model ID currently active for the selected provider.
   * Falls back to the legacy global `settings.model` when the sub-object has none.
   */
  function resolveProviderModel(settings) {
    const meta = getProviderMeta(settings);
    return settings?.[meta.configKey]?.model || settings?.model || '';
  }

  return { PROVIDER_META, getProviderId, getProviderMeta, resolveProviderModel };
})();
