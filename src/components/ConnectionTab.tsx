'use client';

import React from 'react';
import {
  Settings,
  ShieldCheck,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Check,
  ShieldAlert,
  AlertCircle,
  Plus,
  Link as LinkIcon,
  HelpCircle,
  Info,
} from 'lucide-react';
import { formatDate } from '@/lib/metrics';

interface ConnectionTabProps {
  currentRole: string;
  triggerRefresh: number;
  onRefresh: () => void;
}

interface AdAccountItem {
  id: string;
  accountId: string;
  accountName: string;
  currency: string;
  timezoneName: string;
  businessId?: string | null;
  status?: string | null;
}

interface MetaConnectionItem {
  id: string;
  connectionName: string;
  graphApiVersion: string;
  encryptedAccessToken: string;
  status: 'connected' | 'disconnected' | 'error' | string;
  lastTestedAt?: string | null;
  lastSyncAt?: string | null;
  syncStartDate: string;
  syncFrequency: string;
  adAccounts: AdAccountItem[];
}

export default function ConnectionTab({ currentRole, triggerRefresh, onRefresh }: ConnectionTabProps) {
  const [connections, setConnections] = React.useState<MetaConnectionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Form states for new connection
  const [connectionName, setConnectionName] = React.useState('Dewey Main Ads Account');
  const [graphApiVersion, setGraphApiVersion] = React.useState('v25.0');
  const [accessToken, setAccessToken] = React.useState('');
  const [initialAccountId, setInitialAccountId] = React.useState('');
  const [appId, setAppId] = React.useState('');
  const [appSecret, setAppSecret] = React.useState('');
  const [syncStartDate, setSyncStartDate] = React.useState('2026-05-15');
  const [syncFrequency, setSyncFrequency] = React.useState('Daily');

  const [showToken, setShowToken] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  // Per-connection action states
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [syncingId, setSyncingId] = React.useState<string | null>(null);
  const [manualAccountInputs, setManualAccountInputs] = React.useState<Record<string, string>>({});
  const [addingAccountId, setAddingAccountId] = React.useState<string | null>(null);
  const [feedbackMap, setFeedbackMap] = React.useState<
    Record<string, { type: 'success' | 'error' | 'info'; title: string; message: string; details?: any }>
  >({});

  React.useEffect(() => {
    async function fetchConnections() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/meta/connections');
        const result = await res.json();
        if (result.error) {
          setError(result.error);
        } else {
          setConnections(result.connections || []);
        }
      } catch (err: unknown) {
        setError((err as Error).message || 'Failed to load connections');
      } finally {
        setLoading(false);
      }
    }
    fetchConnections();
  }, [triggerRefresh]);

  const handleCreateConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentRole !== 'admin') {
      alert('Chỉ có tài khoản Admin mới có quyền thêm/sửa kết nối Meta API.');
      return;
    }

    if (!accessToken.trim()) {
      alert('Vui lòng nhập Access Token!');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/meta/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionName,
          graphApiVersion,
          accessToken: accessToken.trim(),
          adAccountId: initialAccountId.trim() || undefined,
          appId: appId.trim() || undefined,
          appSecret: appSecret.trim() || undefined,
          syncStartDate,
          syncFrequency,
        }),
      });

      const result = await res.json();
      if (result.success) {
        setAccessToken('');
        setInitialAccountId('');
        setAppId('');
        setAppSecret('');
        onRefresh();
        alert('Đã lưu thông tin kết nối thành công! Bạn có thể bấm "Xác thực (Test)" hoặc "Đồng bộ Accounts".');
      } else {
        alert(result.error || 'Lỗi khi lưu kết nối');
      }
    } catch (err: unknown) {
      alert('Lỗi: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/meta/connections/${id}/test`, { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        setFeedbackMap(prev => ({
          ...prev,
          [id]: {
            type: 'success',
            title: 'Xác thực Token thành công!',
            message: result.message || 'Token Meta API hợp lệ và sẵn sàng kết nối.',
            details: result.details,
          },
        }));
        onRefresh();
      } else {
        setFeedbackMap(prev => ({
          ...prev,
          [id]: {
            type: 'error',
            title: 'Xác thực Token không thành công',
            message: result.error || 'Token không hợp lệ hoặc đã hết hạn.',
            details: result.technicalDetails,
          },
        }));
      }
    } catch (err: unknown) {
      setFeedbackMap(prev => ({
        ...prev,
        [id]: {
          type: 'error',
          title: 'Lỗi kết nối mạng',
          message: (err as Error).message || 'Không thể gửi yêu cầu kiểm tra token.',
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleFetchAccounts = async (id: string) => {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/meta/connections/${id}/fetch-ad-accounts`, { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        setFeedbackMap(prev => ({
          ...prev,
          [id]: {
            type: 'success',
            title: 'Đồng bộ Ad Accounts thành công!',
            message: result.message || `Đã tìm thấy ${result.accounts?.length || 0} tài khoản quảng cáo.`,
          },
        }));
        onRefresh();
      } else {
        setFeedbackMap(prev => ({
          ...prev,
          [id]: {
            type: 'error',
            title: 'Đồng bộ Ad Accounts thất bại',
            message: result.error || 'Không thể lấy danh sách tài khoản quảng cáo.',
            details: result.technicalDetails,
          },
        }));
      }
    } catch (err: unknown) {
      setFeedbackMap(prev => ({
        ...prev,
        [id]: {
          type: 'error',
          title: 'Lỗi đường truyền',
          message: (err as Error).message || 'Lỗi khi gọi API đồng bộ accounts.',
        },
      }));
    } finally {
      setSyncingId(null);
    }
  };

  const handleAddManualAccount = async (connectionId: string) => {
    const rawInput = manualAccountInputs[connectionId] || '';
    if (!rawInput.trim()) {
      alert('Vui lòng nhập Ad Account ID (ví dụ: act_2938472948 hoặc 2938472948)!');
      return;
    }

    setAddingAccountId(connectionId);
    try {
      const res = await fetch(`/api/meta/connections/${connectionId}/ad-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: rawInput.trim() }),
      });
      const result = await res.json();

      if (result.success) {
        setManualAccountInputs(prev => ({ ...prev, [connectionId]: '' }));
        setFeedbackMap(prev => ({
          ...prev,
          [connectionId]: {
            type: 'success',
            title: 'Liên kết Ad Account thành công!',
            message: result.message,
          },
        }));
        onRefresh();
      } else {
        setFeedbackMap(prev => ({
          ...prev,
          [connectionId]: {
            type: 'error',
            title: 'Không thể liên kết Ad Account',
            message: result.error || 'Tài khoản không tồn tại hoặc Token không có quyền truy cập.',
            details: result.technicalDetails,
          },
        }));
      }
    } catch (err: unknown) {
      setFeedbackMap(prev => ({
        ...prev,
        [connectionId]: {
          type: 'error',
          title: 'Lỗi hệ thống',
          message: (err as Error).message || 'Lỗi khi kiểm tra tài khoản.',
        },
      }));
    } finally {
      setAddingAccountId(null);
    }
  };

  const handleUnlinkAccount = async (connectionId: string, accountId: string) => {
    if (!confirm(`Bạn có chắc chắn muốn gỡ tài khoản ${accountId} khỏi kết nối này?`)) return;

    try {
      const res = await fetch(
        `/api/meta/connections/${connectionId}/ad-accounts?accountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE' }
      );
      const result = await res.json();
      if (result.success) {
        onRefresh();
      } else {
        alert(result.error || 'Không thể gỡ tài khoản');
      }
    } catch (err: unknown) {
      alert('Lỗi: ' + (err as Error).message);
    }
  };

  const handleRemoveConnection = async (id: string) => {
    if (currentRole !== 'admin') {
      alert('Chỉ có tài khoản Admin mới có quyền xóa kết nối API.');
      return;
    }
    if (
      !confirm(
        'Bạn có chắc chắn muốn XÓA kết nối này? Mọi dữ liệu chiến dịch và insights đồng bộ liên quan cũng sẽ bị xóa khỏi cơ sở dữ liệu!'
      )
    )
      return;

    try {
      const res = await fetch(`/api/meta/connections/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        onRefresh();
        setFeedbackMap(prev => {
          const updated = { ...prev };
          delete updated[id];
          return updated;
        });
        alert('Đã gỡ bỏ kết nối Meta thành công.');
      } else {
        alert(result.error || 'Failed to remove connection');
      }
    } catch (err: unknown) {
      alert('Error: ' + (err as Error).message);
    }
  };

  const isAdmin = currentRole === 'admin';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Configuration Form (Left Panel) */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl space-y-4">
        <div>
          <h3 className="font-extrabold text-lg text-slate-200 flex items-center">
            <Settings className="w-5 h-5 text-indigo-400 mr-2" /> Thiết lập kết nối Meta API
          </h3>
          <p className="text-xs text-slate-500">Nhập Access Token và cấu hình để kết nối với Meta Marketing API</p>
        </div>

        {!isAdmin && (
          <div className="p-3.5 bg-rose-950/20 border border-rose-500/20 rounded-xl text-3xs text-rose-300 flex items-center space-x-2">
            <ShieldAlert className="w-4.5 h-4.5 shrink-0" /> <span>Chỉ Admin mới sửa được API credentials.</span>
          </div>
        )}

        <form onSubmit={handleCreateConnection} className="space-y-4 text-xs">
          <div>
            <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">
              Tên kết nối (Connection Name)
            </label>
            <input
              type="text"
              value={connectionName}
              onChange={e => setConnectionName(e.target.value)}
              disabled={!isAdmin}
              placeholder="Dewey School Main Ads"
              className="w-full px-3.5 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">Graph API Version</label>
              <input
                type="text"
                value={graphApiVersion}
                onChange={e => setGraphApiVersion(e.target.value)}
                disabled={!isAdmin}
                placeholder="v25.0"
                className="w-full px-3.5 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none font-mono text-2xs"
              />
            </div>
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">
                Ad Account ID (Tùy chọn)
              </label>
              <input
                type="text"
                value={initialAccountId}
                onChange={e => setInitialAccountId(e.target.value)}
                disabled={!isAdmin}
                placeholder="act_2938472948"
                className="w-full px-3.5 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none font-mono text-2xs"
              />
            </div>
          </div>

          <div>
            <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">
              Meta Access Token
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={e => setAccessToken(e.target.value)}
                disabled={!isAdmin}
                placeholder="Nhập User Access Token hoặc System User Token"
                className="w-full pl-3.5 pr-10 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none font-mono text-2xs"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-350"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-4xs text-slate-500 mt-1">
              Token được mã hóa AES-256 an toàn trong database. Hệ thống không bao giờ hiển thị token đầy đủ ra giao diện.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-850 pt-4">
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">Ngày bắt đầu Sync</label>
              <input
                type="date"
                value={syncStartDate}
                onChange={e => setSyncStartDate(e.target.value)}
                disabled={!isAdmin}
                className="w-full px-3.5 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none text-2xs"
              />
            </div>
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">Tần suất Sync tự động</label>
              <select
                value={syncFrequency}
                onChange={e => setSyncFrequency(e.target.value)}
                disabled={!isAdmin}
                className="w-full px-3.5 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none text-2xs"
              >
                <option value="Manual">Thủ công (Manual)</option>
                <option value="Every 1 hour">Mỗi 1 giờ</option>
                <option value="Every 6 hours">Mỗi 6 giờ</option>
                <option value="Daily">Hàng ngày (Daily)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5 text-3xs text-slate-500 leading-relaxed border-t border-slate-850 pt-4">
            <span className="font-extrabold uppercase text-slate-400 block">Quy chuẩn quyền hạn Token:</span>
            <p>
              • <span className="font-bold text-emerald-400">ads_read</span>: Bắt buộc. Đọc tài khoản, chiến dịch, nhóm quảng cáo, bài quảng cáo và insights.
            </p>
            <p>
              • <span className="font-bold text-sky-400">business_management</span>: Tùy chọn. Chỉ cần khi muốn lấy thông tin tổ chức Business Manager. Không ảnh hưởng đến đồng bộ Ad Accounts.
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting || !isAdmin}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center space-x-2"
          >
            <ShieldCheck className="w-4.5 h-4.5" /> <span>Lưu kết nối</span>
          </button>
        </form>
      </div>

      {/* Connection List Panel (Right Panel) */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl lg:col-span-2 space-y-6">
        <div>
          <h3 className="font-extrabold text-lg text-slate-200">Danh sách kết nối đã lưu</h3>
          <p className="text-xs text-slate-500">Quản lý trạng thái xác thực Meta API và danh sách Ad Accounts</p>
        </div>

        {loading ? (
          <div className="text-center py-10 text-slate-500 text-xs animate-pulse">Đang tải kết nối...</div>
        ) : error ? (
          <div className="text-xs text-rose-400">{error}</div>
        ) : connections.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-slate-850 rounded-2xl text-slate-500 text-xs">
            Chưa có kết nối Meta Ads nào được tạo. Hãy nhập thông tin và lưu kết nối đầu tiên!
          </div>
        ) : (
          <div className="space-y-6">
            {connections.map(conn => {
              const feedback = feedbackMap[conn.id];
              const manualAcc = manualAccountInputs[conn.id] || '';

              return (
                <div key={conn.id} className="bg-slate-950/40 border border-slate-850 p-5 rounded-2xl space-y-5">
                  {/* Connection Header & Action Buttons */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className="font-bold text-sm text-slate-200">{conn.connectionName}</span>
                        
                        {/* Token Status Badge */}
                        <span
                          className={`px-2 py-0.5 text-3xs font-extrabold border rounded-full uppercase ${
                            conn.status === 'connected'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : conn.status === 'error'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {conn.status === 'connected' ? 'Token hợp lệ' : conn.status === 'error' ? 'Lỗi kết nối' : 'Chưa kiểm tra'}
                        </span>

                        {/* Account Count Badge */}
                        <span className="px-2 py-0.5 text-3xs font-medium bg-slate-800/80 text-slate-300 border border-slate-700/60 rounded-full">
                          {conn.adAccounts?.length || 0} Ad Accounts
                        </span>
                      </div>

                      <div className="text-3xs text-slate-500 space-x-3">
                        <span>
                          Phiên bản: <span className="font-mono text-slate-400">{conn.graphApiVersion}</span>
                        </span>
                        <span>
                          Token: <span className="font-mono text-slate-400">{conn.encryptedAccessToken}</span>
                        </span>
                        {conn.lastTestedAt && (
                          <span>
                            Kiểm tra: <span className="text-slate-400">{formatDate(conn.lastTestedAt)}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex space-x-2 shrink-0">
                      {/* Button Test / Xác thực */}
                      <button
                        onClick={() => handleTestConnection(conn.id)}
                        disabled={testingId === conn.id}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-650 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-3xs font-bold transition-all border border-indigo-500/20 shadow-md"
                        title="Kiểm tra tính hợp lệ của Token và quyền hạn"
                      >
                        <RefreshCw className={`w-3 h-3 ${testingId === conn.id ? 'animate-spin' : ''}`} />
                        <span>Xác thực (Test)</span>
                      </button>

                      {/* Button Đồng bộ Accounts (Chỉ dùng ads_read) */}
                      <button
                        onClick={() => handleFetchAccounts(conn.id)}
                        disabled={syncingId === conn.id}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-lg text-3xs font-bold transition-all shadow-md"
                        title="Tự động tìm kiếm các Ad Account được cấp quyền trong Token (yêu cầu ads_read)"
                      >
                        <RefreshCw className={`w-3 h-3 ${syncingId === conn.id ? 'animate-spin' : ''}`} />
                        <span>Đồng bộ Accounts</span>
                      </button>

                      {/* Button Gỡ kết nối */}
                      {isAdmin && (
                        <button
                          onClick={() => handleRemoveConnection(conn.id)}
                          className="p-1.5 bg-slate-900 border border-slate-800 hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 rounded-lg transition-all"
                          title="Gỡ kết nối"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Feedback / Diagnosis Banner */}
                  {feedback && (
                    <div
                      className={`p-4 rounded-xl border text-xs leading-relaxed ${
                        feedback.type === 'success'
                          ? 'bg-emerald-950/15 border-emerald-500/25 text-slate-300'
                          : 'bg-rose-950/15 border-rose-500/25 text-rose-300'
                      }`}
                    >
                      <div className="flex items-start">
                        {feedback.type === 'success' ? (
                          <Check className="w-4 h-4 mr-2 shrink-0 mt-0.5 text-emerald-400" />
                        ) : (
                          <AlertCircle className="w-4 h-4 mr-2 shrink-0 mt-0.5 text-rose-400" />
                        )}
                        <div className="space-y-1">
                          <span className="font-bold block">{feedback.title}</span>
                          <p className="text-3xs text-slate-400 leading-normal">{feedback.message}</p>

                          {/* Detailed test output if available */}
                          {feedback.details && typeof feedback.details === 'object' && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-3xs text-slate-400 border-t border-slate-800/60 pt-2 mt-2">
                              {feedback.details.userName && (
                                <div>
                                  <span className="text-slate-500 block">Người dùng:</span>
                                  <span className="font-semibold text-slate-200">{feedback.details.userName}</span>
                                </div>
                              )}
                              {feedback.details.hasAdsRead !== undefined && (
                                <div>
                                  <span className="text-slate-500 block">Quyền ads_read:</span>
                                  <span className={feedback.details.hasAdsRead ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                    {feedback.details.hasAdsRead ? '✓ Đã cấp' : '✗ Thiếu'}
                                  </span>
                                </div>
                              )}
                              {feedback.details.hasBusinessManagement !== undefined && (
                                <div>
                                  <span className="text-slate-500 block">Business Manager:</span>
                                  <span className={feedback.details.hasBusinessManagement ? 'text-sky-400 font-bold' : 'text-slate-400'}>
                                    {feedback.details.hasBusinessManagement ? '✓ Đã cấp' : 'Tùy chọn'}
                                  </span>
                                </div>
                              )}
                              {feedback.details.linkedAccountsCount !== undefined && (
                                <div>
                                  <span className="text-slate-500 block">Tài khoản liên kết:</span>
                                  <span className="font-semibold text-slate-200">{feedback.details.linkedAccountsCount}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Technical details if present */}
                          {typeof feedback.details === 'string' && (
                            <p className="text-4xs font-mono text-slate-500 mt-1 break-all">
                              {feedback.details}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Manual Account ID Entry Form */}
                  <div className="p-3.5 bg-slate-900/40 border border-slate-850/80 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-3xs text-slate-400 font-bold uppercase tracking-wider flex items-center">
                        <Plus className="w-3.5 h-3.5 mr-1 text-indigo-400" /> Nhập Ad Account ID thủ công
                      </span>
                      <span className="text-4xs text-slate-500">
                        Hỗ trợ cả dạng <code className="text-slate-400">act_123456789</code> hoặc <code className="text-slate-400">123456789</code>
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manualAcc}
                        onChange={e =>
                          setManualAccountInputs(prev => ({
                            ...prev,
                            [conn.id]: e.target.value,
                          }))
                        }
                        placeholder="Nhập Ad Account ID (ví dụ: act_2938472948)"
                        className="flex-1 px-3 py-2 bg-slate-950/60 border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none font-mono text-2xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddManualAccount(conn.id)}
                        disabled={addingAccountId === conn.id}
                        className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-3xs font-bold transition-all flex items-center space-x-1 shrink-0 shadow-sm"
                      >
                        <LinkIcon className={`w-3 h-3 ${addingAccountId === conn.id ? 'animate-spin' : ''}`} />
                        <span>Kiểm tra & Thêm</span>
                      </button>
                    </div>
                  </div>

                  {/* Linked Ad Accounts List */}
                  <div className="border-t border-slate-850 pt-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-3xs text-slate-500 font-bold uppercase tracking-wider block">
                        Các tài khoản quảng cáo có thể truy cập ({conn.adAccounts?.length || 0}):
                      </span>
                      {conn.adAccounts?.length === 0 && (
                        <span className="text-4xs text-amber-400/90 flex items-center">
                          <Info className="w-3 h-3 mr-1" /> Chưa có account nào. Hãy bấm "Đồng bộ Accounts" hoặc nhập thủ công ở trên.
                        </span>
                      )}
                    </div>

                    {conn.adAccounts && conn.adAccounts.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {conn.adAccounts.map(acc => (
                          <div
                            key={acc.id}
                            className="bg-slate-950/30 p-3 border border-slate-900 rounded-xl flex justify-between items-center text-3xs group hover:border-slate-800 transition-colors"
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center space-x-1.5">
                                <span className="font-bold text-slate-300">{acc.accountName}</span>
                                <span
                                  className={`px-1.5 py-0.2 text-4xs font-bold rounded ${
                                    acc.status === 'ACTIVE'
                                      ? 'bg-emerald-500/10 text-emerald-400'
                                      : 'bg-rose-500/10 text-rose-400'
                                  }`}
                                >
                                  {acc.status || 'ACTIVE'}
                                </span>
                              </div>
                              <span className="text-slate-500 block font-mono text-3xs">{acc.accountId}</span>
                              {acc.businessId && (
                                <span className="text-4xs text-slate-600 block">BM: {acc.businessId}</span>
                              )}
                            </div>

                            <div className="flex items-center space-x-3">
                              <div className="text-right text-slate-400">
                                <span className="font-bold block uppercase">{acc.currency}</span>
                                <span className="text-slate-500 block text-4xs">{acc.timezoneName}</span>
                              </div>

                              {isAdmin && (
                                <button
                                  onClick={() => handleUnlinkAccount(conn.id, acc.accountId)}
                                  className="p-1 text-slate-600 hover:text-rose-400 opacity-60 group-hover:opacity-100 transition-opacity"
                                  title="Gỡ tài khoản này"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 bg-slate-950/20 border border-dashed border-slate-850 rounded-xl text-center text-slate-500 text-3xs">
                        Chưa liên kết tài khoản quảng cáo nào. Bấm "Đồng bộ Accounts" để tự động quét từ token, hoặc nhập mã ID vào ô phía trên.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
