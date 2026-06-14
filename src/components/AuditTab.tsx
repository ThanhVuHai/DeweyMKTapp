'use client';

import React from 'react';
import { ClipboardList, ShieldAlert, Clock, Eye, Code } from 'lucide-react';
import { formatDate } from '@/lib/metrics';

interface AuditTabProps {
  triggerRefresh: number;
}

export default function AuditTab({ triggerRefresh }: AuditTabProps) {
  const [logs, setLogs] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchLogs() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/audit-logs');
        const result = await res.json();
        if (result.error) {
          setError(result.error);
        } else {
          setLogs(result.logs || []);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load audit logs');
      } finally {
        setLoading(false);
      }
    }
    fetchLogs();
  }, [triggerRefresh]);

  const getActionColor = (action: string) => {
    if (action.includes('CREATE')) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (action.includes('DELETE')) return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    if (action.includes('UPDATE')) return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
    if (action.includes('SEED')) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl space-y-4">
      <div>
        <h3 className="font-extrabold text-lg text-slate-200 flex items-center">
          <ClipboardList className="w-5 h-5 text-indigo-400 mr-2" /> Nhật ký hoạt động hệ thống (Audit Logs)
        </h3>
        <p className="text-xs text-slate-500">Xem lịch sử ghi nhận các thao tác quản trị trên ứng dụng</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-slate-500 text-xs animate-pulse">Đang tải nhật ký...</div>
      ) : error ? (
        <div className="bg-red-950/20 border border-red-500/50 text-red-200 p-6 rounded-2xl flex items-center space-x-3 text-xs">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
          <span>Lỗi: {error}</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-850 rounded-2xl text-slate-500 text-xs">
          Hệ thống chưa ghi nhận hoạt động nào.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-3xs text-slate-500 uppercase tracking-wider bg-slate-950/20 border-b border-slate-800/60">
                <tr>
                  <th className="py-3 px-4 font-semibold">Thời gian</th>
                  <th className="py-3 px-4 font-semibold">Tài khoản</th>
                  <th className="py-3 px-4 font-semibold">Hành động</th>
                  <th className="py-3 px-4 font-semibold">Đối tượng</th>
                  <th className="py-3 px-4 font-semibold">Mã đối tượng</th>
                  <th className="py-3 px-4 text-center font-semibold">Dữ liệu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-slate-300">
                {logs.map((log: any) => {
                  const isExpanded = expandedLogId === log.id;
                  const dateLocal = new Date(log.createdAt).toLocaleString('vi-VN');

                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-slate-800/10">
                        <td className="py-3 px-4 font-mono text-3xs text-slate-400 flex items-center space-x-1">
                          <Clock className="w-3 h-3 text-slate-600" />
                          <span>{dateLocal}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-200 block">
                            {log.user?.name || 'Hệ thống (System)'}
                          </span>
                          <span className="text-3xs text-slate-500 block">
                            {log.user?.role || 'Admin'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-block px-2 py-0.5 text-3xs font-extrabold rounded-full border ${getActionColor(log.action)}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-400 font-semibold">{log.entityType}</td>
                        <td className="py-3 px-4 font-mono text-slate-500 text-3xs">{log.entityId}</td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            className="p-1 hover:bg-slate-800 text-slate-500 hover:text-slate-250 rounded-lg transition-all"
                            title="Xem payload JSON"
                          >
                            <Code className="w-4 h-4 inline-block" />
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-slate-950/40 p-4 border-l-2 border-indigo-500">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-2xs font-mono">
                              <div>
                                <span className="text-slate-550 block mb-1 font-bold">Dữ liệu trước (Before):</span>
                                <pre className="bg-slate-950 border border-slate-850 p-2.5 rounded-lg overflow-x-auto text-rose-300 max-h-40">
                                  {log.beforeJson ? JSON.stringify(JSON.parse(log.beforeJson), null, 2) : 'null'}
                                </pre>
                              </div>
                              <div>
                                <span className="text-slate-550 block mb-1 font-bold">Dữ liệu sau (After):</span>
                                <pre className="bg-slate-950 border border-slate-850 p-2.5 rounded-lg overflow-x-auto text-emerald-350 max-h-40">
                                  {log.afterJson ? JSON.stringify(JSON.parse(log.afterJson), null, 2) : 'null'}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
