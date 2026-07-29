import { useState, useMemo, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { api } from '../api/client'
import {
  MODEL_ROLES,
  type ModelRole,
  type ModelRoleMapping,
  type ProviderCredential,
  type ProviderDescriptorPublic,
} from '../types'
import { CloseIcon, TrashIcon, LoaderIcon, RefreshIcon, LinkIcon } from './Icons'
import './ProviderSettings.css'

const CATEGORY_LABELS: Record<string, string> = {
  'api-key': 'API 키',
  'openai-compat': 'OpenAI 호환',
}

const ROLE_LABELS: Record<ModelRole, string> = {
  default: '기본(default)',
  smol: '빠름(smol)',
  slow: '심층(slow)',
  plan: '계획(plan)',
  commit: '커밋(commit)',
}

const ROLE_HINTS: Record<ModelRole, string> = {
  default: '일반 대화/작업에 사용할 기본 모델',
  smol: '빠르고 가벼운 작업에 적합한 모델',
  slow: '복잡한 추론·심층 분석용 모델',
  plan: '계획 수립에 사용할 모델',
  commit: '커밋 메시지 생성용 모델',
}

type RoleFormRow = { credentialId: string; model: string }

// 역할별 폼 초기값 생성 — roleMappings 우선, 미설정 역할은 기본 프로바이더
// (없으면 첫 프로바이더)의 자격증명 + 기본 모델로 채운다.
function buildRoleForm(
  mappings: ModelRoleMapping[],
  providers: ProviderCredential[],
): Record<ModelRole, RoleFormRow> {
  const fallback = providers.find((p) => p.isDefault) ?? providers[0]
  const form = {} as Record<ModelRole, RoleFormRow>
  for (const role of MODEL_ROLES) {
    const mapping = mappings.find((m) => m.role === role)
    form[role] = mapping
      ? { credentialId: mapping.credentialId, model: mapping.model }
      : fallback
        ? { credentialId: fallback.id, model: fallback.defaultModel }
        : { credentialId: '', model: '' }
  }
  return form
}

export function ProviderSettings() {
  const open = useStore((s) => s.providerSettingsOpen)
  const closeProviderSettings = useStore((s) => s.closeProviderSettings)
  const providers = useStore((s) => s.providers)
  const availableProviders = useStore((s) => s.availableProviders)
  const providersLoading = useStore((s) => s.providersLoading)
  const saveProvider = useStore((s) => s.saveProvider)
  const setDefaultProvider = useStore((s) => s.setDefaultProvider)
  const deleteProvider = useStore((s) => s.deleteProvider)
  const oauthProviders = useStore((s) => s.oauthProviders)
  const oauthPending = useStore((s) => s.oauthPending)
  const startOAuthLogin = useStore((s) => s.startOAuthLogin)
  const cancelOAuthLogin = useStore((s) => s.cancelOAuthLogin)
  const loadProviders = useStore((s) => s.loadProviders)
  const roleMappings = useStore((s) => s.roleMappings)
  const saveRoleMappings = useStore((s) => s.saveRoleMappings)

  // 폼 상태
  const [selectedProvider, setSelectedProvider] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [isDefault, setIsDefault] = useState(true)
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // 역할별 모델 폼 상태 (자격증명 + 모델 per role)
  const [roleForm, setRoleForm] = useState<Record<ModelRole, RoleFormRow>>(() =>
    buildRoleForm(roleMappings, providers),
  )
  const [roleSaving, setRoleSaving] = useState(false)
  // 행별 모델 새로고침 로딩 상태 (provider id, 없으면 null)
  const [refreshingModels, setRefreshingModels] = useState<string | null>(null)

  // 오버레이가 열릴 때 폼 초기화 (프로바이더가 없으면 기본 체크)
  useEffect(() => {
    if (open) {
      setSelectedProvider('')
      setApiKey('')
      setBaseUrl('')
      setModel('')
      setDiscoveredModels([])
      setError(null)
      setIsDefault(useStore.getState().providers.length === 0)
    }
  }, [open])
  // 오버레이가 닫히면 진행 중인 OAuth 폴링 정리
  useEffect(() => {
    if (!open) cancelOAuthLogin()
  }, [open, cancelOAuthLogin])
  // providers/roleMappings 변경 시 역할 폼 재초기화 (저장 후 새 상태 반영)
  useEffect(() => {
    setRoleForm(buildRoleForm(roleMappings, providers))
  }, [roleMappings, providers])

  // api-key / openai-compat 카테고리로 그룹화
  const grouped = useMemo(() => {
    const byCat: Record<string, ProviderDescriptorPublic[]> = {}
    for (const p of availableProviders) {
      if (p.category !== 'api-key' && p.category !== 'openai-compat') continue
      ;(byCat[p.category] ??= []).push(p)
    }
    return byCat
  }, [availableProviders])

  if (!open) return null

  const selectedDescriptor = availableProviders.find((p) => p.id === selectedProvider)
  const existingRow = providers.find((p) => p.provider === selectedProvider)

  const handleSelectProvider = (id: string) => {
    setSelectedProvider(id)
    setDiscoveredModels([])
    setError(null)
    setApiKey('')
    setBaseUrl('')
    setModel('')
  }

  const handleDiscover = async () => {
    if (!selectedProvider) return
    // 저장 전(새 프로바이더)이면 API 키를 먼저 입력받아야 임시 조회 가능
    if (!existingRow && !apiKey.trim()) {
      setError('API 키를 먼저 입력하세요')
      return
    }
    setDiscovering(true)
    setError(null)
    try {
      const models = existingRow
        ? await api.discoverModels(existingRow.id)
        : await api.discoverModelsTransient({
            provider: selectedProvider,
            apiKey: apiKey.trim(),
            baseUrlOverride: baseUrl.trim() || undefined,
          })
      setDiscoveredModels(models)
      if (models.length && !model) setModel(models[0])
    } catch (e) {
      setError(e instanceof Error ? e.message : '모델 목록을 불러오지 못했습니다')
    } finally {
      setDiscovering(false)
    }
  }

  const handleSave = async () => {
    if (!selectedDescriptor) {
      setError('프로바이더를 선택하세요')
      return
    }
    if (!model.trim()) {
      setError('모델을 입력하세요')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveProvider({
        provider: selectedDescriptor.id,
        apiKey: apiKey.trim() || undefined,
        baseUrlOverride: baseUrl.trim() || undefined,
        defaultModel: model.trim(),
        isDefault,
      })
      // 저장 성공 → 폼 초기화
      setSelectedProvider('')
      setApiKey('')
      setBaseUrl('')
      setModel('')
      setDiscoveredModels([])
      setIsDefault(useStore.getState().providers.length === 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다')
    } finally {
      setSaving(false)
    }
  }

  const handleSetDefault = async (id: string) => {
    setError(null)
    try {
      await setDefaultProvider(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '기본 프로바이더 설정 중 오류가 발생했습니다')
    }
  }

  const handleDelete = async (id: string) => {
    setError(null)
    try {
      await deleteProvider(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '프로바이더 삭제 중 오류가 발생했습니다')
    }
  }
  const handleRefreshModels = async (id: string) => {
    setRefreshingModels(id)
    setError(null)
    try {
      await api.discoverModels(id)
      await loadProviders()
    } catch (e) {
      setError(e instanceof Error ? e.message : '모델 목록을 새로고침하지 못했습니다')
    } finally {
      setRefreshingModels(null)
    }
  }
  const handleCopyCode = async () => {
    const code = oauthPending?.userCode
    if (!code) return
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code)
      } else {
        // HTTP(비보안 컨텍스트) 폴백 — 임시 textarea + execCommand. clipboard API가 없을 때 쓴다.
        const ta = document.createElement('textarea')
        ta.value = code
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 최후의 수단: 코드 영역을 사용자가 직접 선택하도록 둔다.
    }
  }

  const handlePkceComplete = async () => {
    cancelOAuthLogin()
    await loadProviders()
  }
  const handleRoleCredentialChange = (role: ModelRole, credentialId: string) => {
    const provider = providers.find((p) => p.id === credentialId)
    setRoleForm((prev) => ({
      ...prev,
      [role]: {
        credentialId,
        // 자격증명이 바뀌면 해당 프로바이더의 기본 모델로 갱신
        model: provider ? provider.defaultModel : prev[role].model,
      },
    }))
  }

  const handleRoleModelChange = (role: ModelRole, model: string) => {
    setRoleForm((prev) => ({
      ...prev,
      [role]: { credentialId: prev[role].credentialId, model },
    }))
  }

  const handleSaveRoles = async () => {
    const roles: Array<{ role: string; credentialId: string; model: string }> = []
    for (const role of MODEL_ROLES) {
      const row = roleForm[role]
      if (row && row.credentialId && row.model.trim()) {
        roles.push({ role, credentialId: row.credentialId, model: row.model.trim() })
      }
    }
    if (roles.length === 0) {
      setError('저장할 역할 매핑이 없습니다. 프로바이더를 먼저 추가하세요.')
      return
    }
    setRoleSaving(true)
    setError(null)
    try {
      await saveRoleMappings(roles)
    } catch (e) {
      setError(e instanceof Error ? e.message : '역할 매핑 저장 중 오류가 발생했습니다')
    } finally {
      setRoleSaving(false)
    }
  }

  return (
    <div className="ps-overlay" onClick={closeProviderSettings}>
      <div className="ps-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* 헤더 */}
        <div className="ps-header">
          <h2>LLM 프로바이더 설정</h2>
          <button className="ps-close-btn" onClick={closeProviderSettings} aria-label="닫기">
            <CloseIcon size={18} />
          </button>
        </div>

        {error && <div className="ps-error">{error}</div>}

        <div className="ps-body">
          {/* 설정된 프로바이더 목록 */}
          <section className="ps-section">
            <h3 className="ps-section-title">설정된 프로바이더</h3>
            {providersLoading ? (
              <div className="ps-loading">
                <LoaderIcon size={20} className="spin" />
                <span>불러오는 중...</span>
              </div>
            ) : providers.length === 0 ? (
              <p className="ps-empty">설정된 프로바이더가 없습니다.</p>
            ) : (
              <ul className="ps-provider-list">
                {providers.map((p) => {
                  const cachedModels = p.cachedModels ?? []
                  return (
                    <li key={p.id} className="ps-provider-row">
                      <div className="ps-provider-info">
                        <div className="ps-provider-name">
                          {p.displayName}
                          {p.isDefault && <span className="ps-default-badge">기본</span>}
                        </div>
                        <div className="ps-provider-meta">
                          <span className="ps-mono">{p.provider}</span>
                          <span className="ps-dot">·</span>
                          <span className="ps-mono">{p.defaultModel}</span>
                          <span className="ps-dot">·</span>
                          <span className={p.authType === 'oauth' || p.hasApiKey ? 'ps-key-ok' : 'ps-key-missing'}>
                            {p.authType === 'oauth' ? 'OAuth 연결됨' : p.hasApiKey ? 'API 키 설정됨' : 'API 키 없음'}
                          </span>
                        </div>
                        <div className="ps-provider-models">
                          {cachedModels.length > 0 ? (
                            <>
                              <span className="ps-models-count">모델 {cachedModels.length}개</span>
                              <span className="ps-models-chips">
                                {cachedModels.slice(0, 4).map((m) => (
                                  <span key={m} className="ps-model-chip ps-mono">{m}</span>
                                ))}
                                {cachedModels.length > 4 && <span className="ps-models-more">…</span>}
                              </span>
                            </>
                          ) : (
                            <span className="ps-models-empty">모델 목록 미확보</span>
                          )}
                          <button
                            type="button"
                            className="ps-action-btn ps-refresh-models-btn"
                            onClick={() => void handleRefreshModels(p.id)}
                            disabled={refreshingModels === p.id}
                          >
                            {refreshingModels === p.id ? (
                              <LoaderIcon size={12} className="spin" />
                            ) : (
                              <RefreshIcon size={12} />
                            )}
                            <span>모델 새로고침</span>
                          </button>
                        </div>
                      </div>
                      <div className="ps-provider-actions">
                        <button
                          className="ps-action-btn"
                          onClick={() => handleSetDefault(p.id)}
                          disabled={p.isDefault}
                        >
                          기본으로 설정
                        </button>
                        <button
                          className="ps-action-btn danger"
                          onClick={() => handleDelete(p.id)}
                        >
                          <TrashIcon size={13} />
                          삭제
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* 역할별 모델 (role → provider+model 라우팅) */}
          <section className="ps-section">
            <h3 className="ps-section-title">역할별 모델</h3>
            <div className="ps-role-list">
              {MODEL_ROLES.map((role) => {
                const row = roleForm[role]
                const roleCred = providers.find((p) => p.id === row.credentialId)
                const roleModels = roleCred?.cachedModels ?? []
                return (
                  <div key={role} className="ps-role-row">
                    <div className="ps-role-meta">
                      <span className="ps-role-label">{ROLE_LABELS[role]}</span>
                      <span className="ps-hint">{ROLE_HINTS[role]}</span>
                    </div>
                    <div className="ps-role-controls">
                      {providers.length > 0 ? (
                        <select
                          className="ps-select"
                          value={row.credentialId}
                          onChange={(e) => handleRoleCredentialChange(role, e.target.value)}
                        >
                          {!row.credentialId && (
                            <option value="" disabled>프로바이더 선택</option>
                          )}
                          {providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.displayName} · {p.defaultModel}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select className="ps-select" disabled>
                          <option value="">프로바이더 없음</option>
                        </select>
                      )}
                      <input
                        type="text"
                        className="ps-input ps-mono"
                        value={row.model}
                        onChange={(e) => handleRoleModelChange(role, e.target.value)}
                        placeholder="모델 이름"
                        disabled={providers.length === 0}
                        list={`ps-role-models-${role}`}
                      />
                      {roleModels.length > 0 && (
                        <datalist id={`ps-role-models-${role}`}>
                          {roleModels.map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {providers.length === 0 && (
              <p className="ps-empty">먼저 프로바이더를 추가/연결하세요.</p>
            )}
            <button
              type="button"
              className="ps-save-btn ps-role-save-btn"
              onClick={handleSaveRoles}
              disabled={providers.length === 0 || roleSaving}
            >
              {roleSaving ? (
                <>
                  <LoaderIcon size={14} className="spin" />
                  <span>저장 중...</span>
                </>
              ) : (
                <span>역할 매핑 저장</span>
              )}
            </button>
          </section>
          {/* OAuth 로그인 (구독형 프로바이더) */}
          {(oauthProviders.length > 0 || oauthPending) && (
            <section className="ps-section">
              <h3 className="ps-section-title">OAuth 로그인</h3>
              {oauthPending ? (
                oauthPending.flowType === 'device-code' ? (
                  <div className="ps-oauth-device-card">
                    <p className="ps-oauth-step">
                      아래 링크를 열고 표시된 사용자 코드를 입력해 인증을 완료하세요.
                    </p>
                    <a
                      className="ps-oauth-verify-link"
                      href={oauthPending.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <LinkIcon size={14} />
                      <span className="ps-mono">{oauthPending.verificationUri}</span>
                    </a>
                    <div className="ps-oauth-code-box">
                      <span className="ps-oauth-code ps-mono">{oauthPending.userCode}</span>
                      <button
                        type="button"
                        className="ps-action-btn"
                        onClick={handleCopyCode}
                      >
                        {copied ? '복사됨' : '복사'}
                      </button>
                    </div>
                    <div className="ps-oauth-pending">
                      <LoaderIcon size={14} className="spin" />
                      <span>대기 중…</span>
                    </div>
                    <button
                      type="button"
                      className="ps-action-btn"
                      onClick={cancelOAuthLogin}
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <div className="ps-oauth-pkce-card">
                    <p className="ps-oauth-step">
                      브라우저 창에서 로그인을 완료하세요. 완료 후 아래 버튼을 눌러주세요.
                    </p>
                    <div className="ps-provider-actions">
                      <button
                        type="button"
                        className="ps-action-btn"
                        onClick={handlePkceComplete}
                      >
                        완료됨 (새로고침)
                      </button>
                      <button
                        type="button"
                        className="ps-action-btn"
                        onClick={cancelOAuthLogin}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <ul className="ps-provider-list">
                  {oauthProviders.map((p) => (
                    <li key={p.provider} className="ps-provider-row">
                      <div className="ps-provider-info">
                        <div className="ps-provider-name">{p.displayName}</div>
                        <div className="ps-provider-meta">
                          <span className="ps-mono">{p.provider}</span>
                          <span className="ps-dot">·</span>
                          <span>{p.flowType === 'device-code' ? '기기 코드' : '브라우저 인증'}</span>
                        </div>
                      </div>
                      <div className="ps-provider-actions">
                        <button
                          type="button"
                          className="ps-action-btn"
                          onClick={() => void startOAuthLogin(p.provider)}
                        >
                          연결
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* 프로바이더 추가/구성 폼 */}
          <section className="ps-section">
            <h3 className="ps-section-title">프로바이더 추가</h3>
            <div className="ps-form">
              <div className="ps-field">
                <label>프로바이더</label>
                <select
                  className="ps-select"
                  value={selectedProvider}
                  onChange={(e) => handleSelectProvider(e.target.value)}
                >
                  <option value="" disabled>
                    프로바이더를 선택하세요
                  </option>
                  {Object.entries(grouped).map(([cat, list]) => (
                    <optgroup key={cat} label={CATEGORY_LABELS[cat] ?? cat}>
                      {list.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedDescriptor?.docsUrl && (
                  <a
                    className="ps-docs-link"
                    href={selectedDescriptor.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    문서 보기
                  </a>
                )}
              </div>

              {selectedDescriptor && (
                <>
                  {selectedDescriptor.authFieldLabel && (
                    <div className="ps-field">
                      <label>{selectedDescriptor.authFieldLabel}</label>
                      <input
                        type="password"
                        className="ps-input ps-mono"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={existingRow?.hasApiKey ? '•••••• (입력 시 교체)' : ''}
                        autoComplete="off"
                      />
                      {existingRow?.hasApiKey && (
                        <span className="ps-hint">
                          이미 API 키가 설정되어 있습니다. 비우면 기존 키가 유지됩니다.
                        </span>
                      )}
                    </div>
                  )}

                  <div className="ps-field">
                    <label>Base URL (선택)</label>
                    <input
                      type="text"
                      className="ps-input ps-mono"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder={selectedDescriptor.defaultBaseUrl ?? 'https://api.example.com/v1'}
                    />
                  </div>

                  <div className="ps-field">
                    <label>모델</label>
                    <input
                      type="text"
                      className="ps-input ps-mono"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="gpt-4o, claude-3-5-sonnet 등"
                    />
                    <div className="ps-model-tools">
                      <button
                        type="button"
                        className="ps-discover-btn"
                        onClick={handleDiscover}
                        disabled={discovering}
                      >
                        {discovering ? (
                          <>
                            <LoaderIcon size={13} className="spin" />
                            <span>불러오는 중...</span>
                          </>
                        ) : (
                          <>
                            <RefreshIcon size={13} />
                            <span>모델 불러오기</span>
                          </>
                        )}
                      </button>
                      {!existingRow && (
                        <span className="ps-hint">
                          API 키를 입력하면 저장 전에도 모델을 불러올 수 있습니다.
                        </span>
                      )}
                    </div>
                    {discoveredModels.length > 0 && (
                      <select
                        className="ps-select ps-model-select"
                        value={discoveredModels.includes(model) ? model : ''}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        <option value="" disabled>불러온 모델 선택</option>
                        {discoveredModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <label className="ps-checkbox-row">
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                    />
                    <span>기본 프로바이더로 사용</span>
                  </label>
                </>
              )}
            </div>
          </section>
        </div>

        {/* 푸터 */}
        <div className="ps-footer">
          <button className="ps-cancel-btn" onClick={closeProviderSettings}>
            닫기
          </button>
          <button
            className="ps-save-btn"
            onClick={handleSave}
            disabled={!selectedDescriptor || !model.trim() || saving}
          >
            {saving ? (
              <>
                <LoaderIcon size={14} className="spin" />
                <span>저장 중...</span>
              </>
            ) : (
              <span>저장</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
