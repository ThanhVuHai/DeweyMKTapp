'use client';

import React from 'react';
import { Settings, ShieldCheck, Trash2, Key, RefreshCw, Eye, EyeOff, Check, X, ShieldAlert, AlertCircle } from 'lucide-react';
import { formatDate } from '@/lib/metrics';

interface ConnectionTabProps {
  currentRole: string;
  triggerRefresh: number;
  onRefresh: () => void;
}

export default function ConnectionTab({ currentRole, triggerRefresh, onRefresh }: ConnectionTabProps) {
  const [connections, setConnections] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Form states
  const [connectionName, setConnectionName] = React.useState('Dewey Main Ads Account');
  const [graphApiVersion, setGraphApiVersion] = React.useState('v25.0');
  const [accessToken, setAccessToken] = React.useState('');
  const [adAccountId, setAdAccountId] = React.useState('act_2938472948');
  const [appId, setAppId] = React.useState('');
  const [appSecret, setAppSecret] = React.useState('');
  const [syncStartDate, setSyncStartDate] = React.useState('2026-05-15');
  const [syncFrequency, setSyncFrequency] = React.useState('Daily');
  
  const [showToken, setShowToken] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  
  // Test diagnostic logs
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<any | null>(null);
  const [syncingId, setSyncingId] = React.useState<string | null>(null);

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
      } catch (err: any) {
        setError(err.message || 'Failed to load connections');
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

    if (!accessToken) {
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
          accessToken,
          appId,
          appSecret,
          syncStartDate,
          syncFrequency,
        }),
      });

      const result = await res.json();
      if (result.success) {
        setAccessToken('');
        setAppId('');
        setAppSecret('');
        onRefresh();
        alert('Đã lưu thông tin kết nối thành công! Hãy bấm Test Connection bên dưới để xác thực.');
      } else {
        alert(result.error || 'Failed to save connection');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/meta/connections/${id}/test`, { method: 'POST' });
      const result = await res.json();
      setTestResult({
        id,
        success: result.success,
        message: result.message || '',
        error: result.error || '',
        details: result.details || null,
      });
      if (result.success) {
        onRefresh(); // reload status connected
      }
    } catch (err: any) {
      setTestResult({
        id,
        success: false,
        error: err.message || 'Network check timeout',
      });
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
        onRefresh();
        alert(`Đã tìm thấy và cập nhật thành công ${result.accounts?.length || 0} Ad Accounts trong token này!`);
      } else {
        alert(result.error || 'Failed to fetch accounts');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSyncingId(null);
    }
  };

  const handleRemoveConnection = async (id: string) => {
    if (currentRole !== 'admin') {
      alert('Chỉ có tài khoản Admin mới có quyền xóa kết nối API.');
      return;
    }
    if (!confirm('Bạn có chắc chắn muốn XÓA kết nối này? Mọi dữ liệu chiến dịch và insights đồng bộ liên quan cũng sẽ bị xóa khỏi cơ sở dữ liệu!')) return;

    try {
      const res = await fetch(`/api/meta/connections/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        onRefresh();
        setTestResult(null);
        alert('Đã gỡ bỏ kết nối Meta thành công.');
      } else {
        alert(result.error || 'Failed to remove connection');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
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
            <ShieldAlert className="w-4.5 h-4.5" /> <span>Chỉ Admin mới sửa được API credentials.</span>
          </div>
        )}

        <form onSubmit={handleCreateConnection} className="space-y-4 text-xs">
          <div>
            <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">Tên kết nối (Connection Name)</label>
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
                className="w-full px-3.5 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">Ad Account ID</label>
              <input
                type="text"
                value={adAccountId}
                onChange={e => setAdAccountId(e.target.value)}
                disabled={!isAdmin}
                placeholder="act_123456789"
                className="w-full px-3.5 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">Meta Access Token</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={e => setAccessToken(e.target.value)}
                disabled={!isAdmin}
                placeholder="Nhập Access Token (EAAB...)"
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
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-850 pt-4">
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">Ngày bắt đầu Sync</label>
              <input
                type="date"
                value={syncStartDate}
                onChange={e => setSyncStartDate(e.target.value)}
                disabled={!isAdmin}
                className="w-full px-3.5 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1 uppercase">Tần suất Sync tự động</label>
              <select
                value={syncFrequency}
                onChange={e => setSyncFrequency(e.target.value)}
                disabled={!isAdmin}
                className="w-full px-3.5 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
              >
                <option value="Manual">Thủ công (Manual)</option>
                <option value="Every 1 hour">Mỗi 1 giờ</option>
                <option value="Every 6 hours">Mỗi 6 giờ</option>
                <option value="Daily">Hàng ngày (Daily)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5 text-3xs text-slate-500 leading-relaxed border-t border-slate-850 pt-4">
            <span className="font-extrabold uppercase text-slate-400 block">Quyền hạn Token yêu cầu:</span>
            <p>• <span className="font-bold text-indigo-400">ads_read</span>: dùng để đọc dữ liệu báo cáo (Bắt buộc).</p>
            <p>• <span className="font-bold text-indigo-400">ads_management</span>: dùng để chỉnh sửa ads (Không bắt buộc ở MVP).</p>
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
          <p className="text-xs text-slate-500">Các cấu hình tài khoản kết nối đang được quản lý trên hệ thống</p>
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
            {connections.map((conn: any) => (
              <div key={conn.id} className="bg-slate-950/40 border border-slate-850 p-5 rounded-2xl space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-slate-200">{conn.connectionName}</span>
                      <span className={`px-2 py-0.5 text-3xs font-extrabold border rounded-full uppercase ${conn.status === 'connected' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : conn.status === 'error' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                        {conn.status}
                      </span>
                    </div>
                    <div className="text-3xs text-slate-500 space-x-3">
                      <span>Phiên bản: <span className="font-mono">{conn.graphApiVersion}</span></span>
                      <span>Token: <span className="font-mono text-slate-400">{conn.encryptedAccessToken}</span></span>
                    </div>
                  </div>

                  <div className="flex space-x-2 shrink-0">
                    <button
                      onClick={() => handleTestConnection(conn.id)}
                      disabled={testingId === conn.id}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-650 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-3xs font-bold transition-all border border-indigo-500/20 shadow-md"
                    >
                      <RefreshCw className={`w-3 h-3 ${testingId === conn.id ? 'animate-spin' : ''}`} /> <span>Xác thực (Test)</span>
                    </button>
                    
                    <button
                      onClick={() => handleFetchAccounts(conn.id)}
                      disabled={syncingId === conn.id}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-lg text-3xs font-bold transition-all shadow-md"
                    >
                      <RefreshCw className="w-3 h-3" /> <span>Đồng bộ Accounts</span>
                    </button>

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

                {/* Show Diagnostic outputs if test run */}
                {testResult && testResult.id === conn.id && (
                  <div className={`p-4 rounded-xl border text-xs leading-relaxed ${testResult.success ? 'bg-emerald-950/10 border-emerald-500/20 text-slate-300' : 'bg-rose-950/10 border-rose-500/20 text-rose-350'}`}>
                    {testResult.success ? (
                      <div className="space-y-2">
                        <div className="flex items-center text-emerald-400 font-bold">
                          <Check className="w-4 h-4 mr-1.5 shrink-0" /> Connected successfully.
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-3xs text-slate-400 border-t border-slate-800/40 pt-2">
                          <div><span className="text-slate-500">Account Name:</span> {testResult.details.accountName}</div>
                          <div><span className="text-slate-500">Account ID:</span> {testResult.details.accountId}</div>
                          <div><span className="text-slate-500">Timezone:</span> {testResult.details.timezone}</div>
                          <div><span className="text-slate-500">Currency:</span> {testResult.details.currency}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start">
                        <AlertCircle className="w-4 h-4 mr-1.5 shrink-0 mt-0.5 text-rose-400" />
                        <div>
                          <span className="font-bold">Lỗi xác thực:</span> {testResult.error || 'Token invalid hoặc không khả dụng'}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Linked Ad Accounts */}
                {conn.adAccounts && conn.adAccounts.length > 0 && (
                  <div className="border-t border-slate-850 pt-3.5 space-y-2">
                    <span className="text-3xs text-slate-500 font-bold uppercase tracking-wider block">Các tài khoản quảng cáo liên kết:</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {conn.adAccounts.map((acc: any) => (
                        <div key={acc.id} className="bg-slate-950/20 p-3 border border-slate-900 rounded-xl flex justify-between items-center text-3xs">
                          <div>
                            <span className="font-bold text-slate-300 block">{acc.accountName}</span>
                            <span className="text-slate-500 block font-mono">{acc.accountId}</span>
                          </div>
                          <div className="text-right text-slate-400">
                            <span className="font-bold block uppercase">{acc.currency}</span>
                            <span className="text-slate-500 block">{acc.timezoneName}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
