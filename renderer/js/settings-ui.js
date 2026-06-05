/**
 * settings-ui.js — Settings view logic for AI Translate
 * Sole Provider: Gemini Enterprise Agent Platform (Vertex AI)
 *
 * Flow:
 *   1. User enters SA JSON + Project ID + Region
 *   2. Click "Xác thực" → testConnection + listModels → show dropdown
 *   3. User selects model → "Lưu cài đặt"
 */
window.SettingsUI = (() => {

  // Complete list of GCP regions that support Vertex AI
  const VERTEX_REGIONS = [
    { value: 'global', label: 'global (Global Endpoint — Dynamic routing)' },
    { value: 'us-central1', label: 'us-central1 (Iowa, USA) — Khuyến nghị' },
    { value: 'us-east1', label: 'us-east1 (South Carolina, USA)' },
    { value: 'us-east4', label: 'us-east4 (Northern Virginia, USA)' },
    { value: 'us-east5', label: 'us-east5 (Columbus, USA)' },
    { value: 'us-south1', label: 'us-south1 (Dallas, USA)' },
    { value: 'us-west1', label: 'us-west1 (Oregon, USA)' },
    { value: 'us-west4', label: 'us-west4 (Las Vegas, USA)' },
    { value: 'northamerica-northeast1', label: 'northamerica-northeast1 (Montreal)' },
    { value: 'northamerica-northeast2', label: 'northamerica-northeast2 (Toronto)' },
    { value: 'southamerica-east1', label: 'southamerica-east1 (São Paulo)' },
    { value: 'europe-central2', label: 'europe-central2 (Warsaw)' },
    { value: 'europe-north1', label: 'europe-north1 (Finland)' },
    { value: 'europe-southwest1', label: 'europe-southwest1 (Madrid)' },
    { value: 'europe-west1', label: 'europe-west1 (Belgium)' },
    { value: 'europe-west2', label: 'europe-west2 (London)' },
    { value: 'europe-west3', label: 'europe-west3 (Frankfurt)' },
    { value: 'europe-west4', label: 'europe-west4 (Netherlands)' },
    { value: 'europe-west6', label: 'europe-west6 (Zurich)' },
    { value: 'europe-west8', label: 'europe-west8 (Milan)' },
    { value: 'europe-west9', label: 'europe-west9 (Paris)' },
    { value: 'me-central1', label: 'me-central1 (Doha)' },
    { value: 'me-west1', label: 'me-west1 (Tel Aviv)' },
    { value: 'asia-east1', label: 'asia-east1 (Taiwan)' },
    { value: 'asia-east2', label: 'asia-east2 (Hong Kong)' },
    { value: 'asia-northeast1', label: 'asia-northeast1 (Tokyo)' },
    { value: 'asia-northeast3', label: 'asia-northeast3 (Seoul)' },
    { value: 'asia-south1', label: 'asia-south1 (Mumbai)' },
    { value: 'asia-southeast1', label: 'asia-southeast1 (Singapore) 🇸🇬' },
    { value: 'asia-southeast2', label: 'asia-southeast2 (Jakarta)' },
    { value: 'australia-southeast1', label: 'australia-southeast1 (Sydney)' },
  ];

  let currentSettings = {};
  let isAuthenticated = false;

  async function init() {
    currentSettings = await window.api.settings.load();
    renderApiKeySection();
    loadFormValues();
    bindEvents();
  }

  function renderApiKeySection() {
    const container = document.getElementById('apikey-content');
    if (!container) return;

    const currentRegion = currentSettings.vertexAI?.region || 'us-central1';
    container.innerHTML = `
      <div class="input-group">
        <label class="input-label">Service Account JSON
          <span class="text-muted">(tùy chọn — bỏ qua nếu dùng ADC)</span>
        </label>
        <div class="input-with-btn" style="align-items:flex-start">
          <textarea class="input" id="setting-vertex-sa" rows="5"
            placeholder='{"type":"service_account","project_id":"...","client_email":"...","private_key":"..."}'
            oninput="SettingsUI.parseVertexJson(this.value)"
            style="font-family:var(--font-mono);font-size:11px">${currentSettings.vertexAI?.serviceAccountJson || ''}</textarea>
          <button class="btn btn-secondary btn-sm" style="flex-shrink:0;margin-top:2px" onclick="SettingsUI.uploadVertexJson()">📁 Upload</button>
        </div>
        <span class="text-xs text-muted mt-sm">Paste JSON trực tiếp — Project ID và Region sẽ tự động điền</span>
      </div>
      <div class="grid-2 mt-md" style="gap:var(--space-md)">
        <div class="input-group">
          <label class="input-label">Project ID <span class="badge badge-blue" style="font-size:9px">Auto</span></label>
          <input class="input" id="setting-vertex-project" type="text"
            placeholder="my-gcp-project"
            value="${currentSettings.vertexAI?.projectId || ''}">
        </div>
        <div class="input-group">
          <label class="input-label">Region</label>
          <select class="input" id="setting-vertex-region">
            ${VERTEX_REGIONS.map(r =>
              `<option value="${r.value}"${r.value === currentRegion ? ' selected' : ''}>${r.label}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <!-- STEP 1: Authenticate -->
      <div style="border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-md);margin-top:var(--space-md)">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:var(--space-sm);text-transform:uppercase;letter-spacing:.05em">Bước 1 — Xác thực & Tải danh sách model</div>
        <div class="flex items-center gap-sm" style="flex-wrap:wrap">
          <button class="btn btn-primary" id="btn-authenticate">🔌 Xác thực</button>
          <span id="auth-result" class="text-sm"></span>
        </div>
      </div>

      <!-- STEP 2: Select Model (hidden until authenticated) -->
      <div id="step-model" style="border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-md);margin-top:var(--space-sm);display:none">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:var(--space-sm);text-transform:uppercase;letter-spacing:.05em">Bước 2 — Chọn model</div>
        <div class="input-group" style="margin-bottom:var(--space-sm)">
          <select class="input" id="setting-model" onchange="SettingsUI.onModelChange(this)"></select>
          <div id="setting-model-pricing" class="text-sm mt-sm text-accent" style="display:none; font-weight: 500;"></div>
          <input class="input mt-sm" type="text" id="setting-model-custom"
            placeholder="Nhập model ID tùy chỉnh..." style="display:none;margin-top:6px">
        </div>
        <div class="flex items-center gap-sm" style="flex-wrap:wrap">
          <button class="btn btn-primary" id="btn-test-save">✅ Kiểm tra & Lưu cài đặt</button>
          <span id="test-result" class="text-sm"></span>
        </div>
      </div>
    `;

    // Bind step buttons
    document.getElementById('btn-authenticate')?.addEventListener('click', authenticate);
    document.getElementById('btn-test-save')?.addEventListener('click', testAndSave);
  }

  // --- Model dropdown ---

  function populateModelDropdown(models) {
    const sel = document.getElementById('setting-model');
    if (!sel) return;

    sel.innerHTML =
      models.map(m => `<option value="${m.id}" data-pricing='${JSON.stringify(m.pricing || null)}'>${m.name}</option>`).join('') +
      `<option value="__custom__">✍️ Tự nhập Model ID...</option>`;

    // Auto-select saved model
    const savedModel = currentSettings.vertexAI?.model || currentSettings.model || '';
    const customInput = document.getElementById('setting-model-custom');

    if (savedModel && models.find(m => m.id === savedModel)) {
      sel.value = savedModel;
      if (customInput) customInput.style.display = 'none';
    } else if (savedModel) {
      sel.value = '__custom__';
      if (customInput) { customInput.value = savedModel; customInput.style.display = ''; }
    } else if (models.length > 0) {
      sel.value = models[0].id;
      if (customInput) customInput.style.display = 'none';
    }
    
    // Trigger change to update pricing UI
    onModelChange(sel);
  }

  function onModelChange(sel) {
    const customInput = document.getElementById('setting-model-custom');
    if (customInput) customInput.style.display = sel.value === '__custom__' ? '' : 'none';

    const pricingEl = document.getElementById('setting-model-pricing');
    if (!pricingEl) return;

    if (sel.value === '__custom__') {
      pricingEl.style.display = 'none';
      return;
    }

    const opt = sel.options[sel.selectedIndex];
    const pricingStr = opt?.getAttribute('data-pricing');
    if (pricingStr && pricingStr !== 'null') {
      try {
        const p = JSON.parse(pricingStr);
        pricingEl.innerHTML = `Bảng giá: Đầu vào <strong>$${p.input}</strong>/1M tokens &#183; Đầu ra <strong>$${p.output}</strong>/1M tokens`;
        pricingEl.style.display = 'block';
      } catch { pricingEl.style.display = 'none'; }
    } else {
      pricingEl.style.display = 'none';
    }
  }

  // --- Parse & Upload SA JSON ---

  function parseVertexJson(jsonText) {
    const ta = document.getElementById('setting-vertex-sa');
    if (!jsonText?.trim()) {
      if (ta) ta.style.borderColor = '';
      return;
    }
    try {
      const sa = JSON.parse(jsonText);

      // Auto-fill project ID
      if (sa.project_id) {
        const el = document.getElementById('setting-vertex-project');
        if (el) el.value = sa.project_id;
      }

      // Validate required fields
      const required = ['type', 'project_id', 'client_email', 'private_key'];
      const missing = required.filter(k => !sa[k]);

      if (missing.length > 0) {
        if (ta) {
          ta.style.borderColor = 'var(--danger)';
          ta.title = `⚠️ Thiếu: ${missing.join(', ')}`;
        }
      } else if (sa.type !== 'service_account') {
        if (ta) {
          ta.style.borderColor = 'var(--danger)';
          ta.title = '⚠️ type phải là "service_account"';
        }
      } else {
        // Valid
        if (ta) {
          ta.style.borderColor = 'var(--success)';
          ta.title = `✅ Service Account: ${sa.client_email}`;
        }
      }
    } catch {
      // JSON not complete or invalid
      if (ta && jsonText.trim().length > 5) {
        ta.style.borderColor = 'var(--danger)';
        ta.title = '⚠️ JSON không hợp lệ';
      }
    }
  }

  async function uploadVertexJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const text = await file.text();
      const ta = document.getElementById('setting-vertex-sa');
      if (ta) { ta.value = text; parseVertexJson(text); }
    };
    input.click();
  }

  // --- Form values ---

  function loadFormValues() {
    const s = currentSettings;
    const q = id => document.getElementById(id);
    if (q('setting-dpi')) q('setting-dpi').value = s.dpi || 300;
    if (q('setting-concurrent')) q('setting-concurrent').value = s.concurrentPages || 2;
    if (q('setting-request-delay')) q('setting-request-delay').value = s.requestDelaySec ?? 2;
    if (q('setting-font')) q('setting-font').value = s.outputFont || 'Times New Roman';
    if (q('setting-pagesize')) q('setting-pagesize').value = s.pageSize || 'A4';
    if (q('setting-fontsize')) q('setting-fontsize').value = s.outputFontSize || 12;
    // translateMode: backward compat — old 'bilingual:true' → 'bilingual', old false → 'clean'
    const mode = s.translateMode || (s.bilingual !== false ? 'bilingual' : 'clean');
    if (q('setting-translate-mode')) q('setting-translate-mode').value = mode;
    if (q('setting-prompt')) q('setting-prompt').value = s.customPrompt || '';
  }

  function bindEvents() {
    document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
  }

  // --- Save settings ---

  async function saveSettings() {
    const q = id => document.getElementById(id);
    const s = { ...currentSettings };
    s.aiProvider = 'vertex-ai';

    let modelValue = q('setting-model')?.value;
    if (modelValue === '__custom__') modelValue = q('setting-model-custom')?.value;
    s.model = modelValue || s.model;

    s.dpi = parseInt(q('setting-dpi')?.value) || 300;
    s.concurrentPages = parseInt(q('setting-concurrent')?.value) || 2;
    s.requestDelaySec = parseInt(q('setting-request-delay')?.value) || 0;
    s.sourceLanguage = 'auto';
    s.translateLanguage = s.translateLanguage || 'Tiếng Việt';
    s.translateMode = q('setting-translate-mode')?.value || 'bilingual';
    s.bilingual = s.translateMode === 'bilingual'; // backward compat
    s.outputFont = q('setting-font')?.value || 'Times New Roman';
    s.pageSize = q('setting-pagesize')?.value || 'A4';
    s.outputFontSize = parseInt(q('setting-fontsize')?.value) || 12;
    s.customPrompt = q('setting-prompt')?.value || '';

    s.vertexAI = {
      projectId: q('setting-vertex-project')?.value?.trim() || '',
      region: q('setting-vertex-region')?.value || 'us-central1',
      model: modelValue || '',
      serviceAccountJson: q('setting-vertex-sa')?.value?.trim() || '',
    };

    await window.api.settings.save(s);
    currentSettings = s;

    // Update provider badge
    window.App?.updateProviderBadge?.();

    UIManager.toast('Đã lưu cài đặt!', 'success');
  }

  // --- STEP 1: Authenticate & load models ---

  async function authenticate() {
    const resultEl = document.getElementById('auth-result');
    if (!resultEl) return;
    resultEl.textContent = '⏳ Đang kết nối...';
    resultEl.style.color = 'var(--text-muted)';

    // Save credentials first
    const q = id => document.getElementById(id);
    const saved = {
      ...currentSettings,
      vertexAI: {
        projectId: q('setting-vertex-project')?.value?.trim() || '',
        region: q('setting-vertex-region')?.value || 'us-central1',
        model: currentSettings.vertexAI?.model || 'gemini-2.5-flash',
        serviceAccountJson: q('setting-vertex-sa')?.value?.trim() || '',
      },
    };
    await window.api.settings.save(saved);
    currentSettings = saved;

    try {
      const res = await window.api.ai.listModels({
        provider: 'vertex-ai',
      });

      if (res.success) {
        isAuthenticated = true;
        resultEl.textContent = `✅ Kết nối thành công, đã lấy danh sách model!`;
        resultEl.style.color = 'var(--success)';

        // Show model dropdown with ALL models from API
        const models = res.models || [];
        if (models.length > 0) {
          populateModelDropdown(models);
          UIManager.toast(`Xác thực thành công! ${models.length} model khả dụng.`, 'success');
        } else {
          // API returned 0 models — still show dropdown with custom input option
          populateModelDropdown([]);
          UIManager.toast('Xác thực OK nhưng không lấy được danh sách model. Hãy tự nhập Model ID.', 'warning');
        }

        const stepModel = document.getElementById('step-model');
        if (stepModel) stepModel.style.display = '';
      } else {
        isAuthenticated = false;
        resultEl.textContent = `❌ ${res.message}`;
        resultEl.style.color = 'var(--danger)';

        const stepModel = document.getElementById('step-model');
        if (stepModel) stepModel.style.display = 'none';
      }
    } catch (e) {
      isAuthenticated = false;
      resultEl.textContent = `❌ ${e.message}`;
      resultEl.style.color = 'var(--danger)';
    }
  }

  // --- STEP 2: Test selected model & save ---

  async function testAndSave() {
    const resultEl = document.getElementById('test-result');
    if (!resultEl) return;
    resultEl.textContent = '⏳ Đang kiểm tra model...';
    resultEl.style.color = 'var(--text-muted)';

    let modelValue = document.getElementById('setting-model')?.value || '';
    if (modelValue === '__custom__') {
      modelValue = document.getElementById('setting-model-custom')?.value || '';
    }

    if (!modelValue) {
      resultEl.textContent = '⚠️ Chưa chọn model';
      resultEl.style.color = 'var(--warning)';
      return;
    }

    // Save model choice temporarily
    currentSettings.vertexAI = { ...currentSettings.vertexAI, model: modelValue };
    currentSettings.model = modelValue;
    await window.api.settings.save(currentSettings);

    try {
      const res = await window.api.ai.testConnection({ provider: 'vertex-ai', model: modelValue });
      if (res.success) {
        resultEl.textContent = `✅ Model "${modelValue}" hoạt động tốt!`;
        resultEl.style.color = 'var(--success)';
        await saveSettings();
        resultEl.textContent = `✅ Đã lưu! Model: ${modelValue}`;
      } else {
        resultEl.textContent = `❌ ${res.message}`;
        resultEl.style.color = 'var(--danger)';
      }
    } catch (e) {
      resultEl.textContent = `❌ ${e.message}`;
      resultEl.style.color = 'var(--danger)';
    }
  }

  return { init, parseVertexJson, uploadVertexJson, onModelChange };
})();
