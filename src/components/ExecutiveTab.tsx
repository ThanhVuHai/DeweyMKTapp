'use client';

import React from 'react';
import { Target, TrendingUp, AlertOctagon, HelpCircle, Check, X, ShieldAlert, Sparkles } from 'lucide-react';
import { formatVND, formatPercent, formatNumber, formatVNDFull } from '@/lib/metrics';

interface ExecutiveTabProps {
  filters: {
    dateFrom: string;
    dateTo: string;
  };
  currentRole: string; // admin, manager, ads_specialist, content, viewer
  triggerRefresh: number;
  onRefresh: () => void;
}

export default function ExecutiveTab({ filters, currentRole, triggerRefresh, onRefresh }: ExecutiveTabProps) {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actioningId, setActioningId] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const queryParams = new URLSearchParams({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        });

        const res = await fetch(`/api/dashboard/executive?${queryParams.toString()}`);
        const result = await res.json();
        
        if (result.error) {
          setError(result.error);
        } else {
          setData(result);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch executive data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters, triggerRefresh]);

  const handleAction = async (id: string, status: 'approved' | 'ignored' | 'done') => {
    // Check permission - Manager or Admin or Specialist only
    if (['viewer', 'content'].includes(currentRole)) {
      alert('Tài khoản của bạn (Viewer/Content) không có quyền phê duyệt đề xuất hành động.');
      return;
    }

    setActioningId(id);
    try {
      const res = await fetch(`/api/recommendations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      
      const result = await res.json();
      if (result.success) {
        onRefresh(); // Refresh parent state
      } else {
        alert(result.error || 'Failed to update action');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setActioningId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-48 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-96 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
          <div className="h-96 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/20 border border-red-500/50 text-red-200 p-6 rounded-2xl flex items-center space-x-4">
        <ShieldAlert className="w-6 h-6 text-red-400 shrink-0" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  const { kpiProgress, campusGradePerformance, sourceBreakdown, managementActions } = data;

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'On track': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'Slightly behind': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'At risk': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'Critical': return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="space-y-8">
      {/* 1. KPI Progress Metrics */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl">
        <h3 className="font-extrabold text-lg text-slate-200 mb-6 flex items-center">
          <Target className="w-5 h-5 text-indigo-400 mr-2" /> Tiến độ mục tiêu chiến dịch (KPI Progress)
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-slate-950/40 p-5 rounded-2xl border border-slate-800/60 space-y-1">
            <span className="text-slate-400 text-xs font-semibold block uppercase">Leads Target</span>
            <div className="flex justify-between items-baseline">
              <span className="text-2xl font-black text-slate-100">{kpiProgress.actualLeads} / {kpiProgress.targetLeads}</span>
              <span className="text-xs text-indigo-400 font-extrabold">{formatPercent(kpiProgress.achievedLeadsPct)}</span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, kpiProgress.achievedLeadsPct)}%` }} />
            </div>
            <span className="text-3xs text-slate-500 block pt-1">Dự báo cuối tháng: {kpiProgress.forecastLeads} leads ({kpiProgress.forecastLeads >= kpiProgress.targetLeads ? 'Đạt' : 'Thiếu'})</span>
          </div>

          <div className="bg-slate-950/40 p-5 rounded-2xl border border-slate-800/60 space-y-1">
            <span className="text-slate-400 text-xs font-semibold block uppercase">Leads Chất Lượng (QL)</span>
            <div className="flex justify-between items-baseline">
              <span className="text-2xl font-black text-slate-100">{kpiProgress.actualQL} / {kpiProgress.targetQL}</span>
              <span className="text-xs text-emerald-400 font-extrabold">{formatPercent((kpiProgress.actualQL / (kpiProgress.targetQL || 1)) * 100)}</span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (kpiProgress.actualQL / (kpiProgress.targetQL || 1)) * 100)}%` }} />
            </div>
            <span className="text-3xs text-slate-500 block pt-1">Required Daily: {kpiProgress.requiredDailyLeads.toFixed(1)} leads / ngày</span>
          </div>

          <div className="bg-slate-950/40 p-5 rounded-2xl border border-slate-800/60 space-y-1">
            <span className="text-slate-400 text-xs font-semibold block uppercase">Đăng ký tham quan (WL)</span>
            <div className="flex justify-between items-baseline">
              <span className="text-2xl font-black text-slate-100">{kpiProgress.actualWL} / {kpiProgress.targetWL}</span>
              <span className="text-xs text-amber-400 font-extrabold">{formatPercent((kpiProgress.actualWL / (kpiProgress.targetWL || 1)) * 100)}</span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, (kpiProgress.actualWL / (kpiProgress.targetWL || 1)) * 100)}%` }} />
            </div>
            <span className="text-3xs text-slate-500 block pt-1">Còn thiếu: {kpiProgress.gapToTarget} leads</span>
          </div>

          <div className="bg-slate-950/40 p-5 rounded-2xl border border-slate-800/60 space-y-1">
            <span className="text-slate-400 text-xs font-semibold block uppercase">Ngân sách sử dụng</span>
            <div className="flex justify-between items-baseline">
              <span className="text-xl font-black text-slate-100">{formatVND(kpiProgress.spend)} / {formatVND(kpiProgress.totalBudget)}</span>
              <span className="text-xs text-rose-400 font-extrabold">{formatPercent((kpiProgress.spend / kpiProgress.totalBudget) * 100)}</span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-rose-500" style={{ width: `${Math.min(100, (kpiProgress.spend / kpiProgress.totalBudget) * 100)}%` }} />
            </div>
            <span className="text-3xs text-slate-500 block pt-1">Còn lại: {formatVNDFull(kpiProgress.budgetRemaining)}</span>
          </div>
        </div>
      </div>

      {/* 2. Campus & Grade Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl lg:col-span-2 space-y-4">
          <div>
            <h3 className="font-extrabold text-lg text-slate-200">Hiệu quả theo Campus / Grade</h3>
            <p className="text-xs text-slate-500">Chi tiết chi phí, CPL, và tiến độ đạt KPI theo cơ sở và khối học</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-3xs text-slate-500 uppercase tracking-wider border-b border-slate-800/60">
                <tr>
                  <th className="pb-3 font-semibold">Cơ sở</th>
                  <th className="pb-3 font-semibold">Khối</th>
                  <th className="pb-3 font-semibold text-right">Chi tiêu</th>
                  <th className="pb-3 font-semibold text-right">Lead</th>
                  <th className="pb-3 font-semibold text-right">CPL</th>
                  <th className="pb-3 font-semibold text-right">QL / CPQL</th>
                  <th className="pb-3 font-semibold text-right">% KPI</th>
                  <th className="pb-3 font-semibold text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-slate-300">
                {campusGradePerformance.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-800/10">
                    <td className="py-3 font-bold text-slate-200">{row.campus}</td>
                    <td className="py-3">{row.grade}</td>
                    <td className="py-3 text-right font-medium">{formatVND(row.spend)}</td>
                    <td className="py-3 text-right">{row.leads}</td>
                    <td className="py-3 text-right text-indigo-400 font-bold">{formatVND(row.cpl)}</td>
                    <td className="py-3 text-right">
                      {row.ql} <span className="text-3xs text-slate-500 block">{formatVND(row.cpql)}</span>
                    </td>
                    <td className="py-3 text-right text-emerald-400 font-bold">{row.kpiProgressPct.toFixed(0)}%</td>
                    <td className="py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 text-3xs font-bold rounded-full border ${getStatusBadgeClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Channel Breakdown */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl space-y-6">
          <div>
            <h3 className="font-extrabold text-lg text-slate-200">Hiệu quả theo Nguồn (Source)</h3>
            <p className="text-xs text-slate-500">So sánh các định dạng chuyển đổi chính</p>
          </div>

          <div className="space-y-4">
            {sourceBreakdown.map((src: any, idx: number) => (
              <div key={idx} className="bg-slate-950/40 border border-slate-800/60 p-4 rounded-2xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm text-slate-200">{src.source}</span>
                  <span className="text-xs text-indigo-400 font-bold">{formatVND(src.spend)}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 text-3xs block">LEADS / CPL</span>
                    <span className="font-extrabold text-slate-300">{src.leads} <span className="text-slate-500 font-medium">({formatVND(src.cpl)})</span></span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-3xs block">QL / CPQL</span>
                    <span className="font-extrabold text-slate-300">{src.ql} <span className="text-slate-500 font-medium">({formatVND(src.cpql)})</span></span>
                  </div>
                </div>
                <div className="flex justify-between text-3xs text-slate-500 border-t border-slate-800/40 pt-2">
                  <span>Lead → QL: <span className="font-bold text-emerald-400">{formatPercent(src.leadToQlRate)}</span></span>
                  <span>QL → WL: <span className="font-bold text-amber-400">{formatPercent(src.qlToWlRate)}</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Next Actions list */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-extrabold text-lg text-slate-200">Đề xuất hành động tiếp theo (Next Actions)</h3>
            <p className="text-xs text-slate-500">Hành động tối ưu hóa ngân sách quảng cáo dựa trên dữ liệu hệ thống đề xuất</p>
          </div>
          <span className="text-3xs text-slate-500 uppercase tracking-widest font-black">Role: {currentRole}</span>
        </div>

        {managementActions.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-slate-800 rounded-2xl bg-slate-950/20">
            <Sparkles className="w-8 h-8 text-indigo-400/50 mx-auto mb-2" />
            <p className="text-xs text-slate-500">Không có đề xuất hành động chưa giải quyết nào.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {managementActions.map((act: any) => (
              <div key={act.id} className="bg-slate-950/30 border border-slate-800/60 p-5 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1.5 max-w-[80%]">
                  <div className="flex items-center space-x-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500" />
                    <h4 className="font-bold text-xs text-slate-200">{act.action}</h4>
                    <span className={`px-2 py-0.5 text-3xs font-extrabold rounded-full ${act.impact.includes('HIGH') ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'}`}>
                      Impact: {act.impact}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed pl-4.5">{act.reason}</p>
                  <div className="text-3xs text-slate-500 pl-4.5 flex items-center space-x-4">
                    <span>Phân công: <span className="text-slate-400 font-bold">{act.owner}</span></span>
                    <span>Trạng thái: <span className="text-slate-400 font-bold uppercase">{act.status}</span></span>
                  </div>
                </div>

                <div className="flex space-x-2 shrink-0 self-end md:self-center">
                  <button
                    onClick={() => handleAction(act.id, 'approved')}
                    disabled={actioningId === act.id}
                    className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl shadow-lg transition-colors flex items-center justify-center"
                    title="Phê duyệt thực hiện"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleAction(act.id, 'ignored')}
                    disabled={actioningId === act.id}
                    className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-xl border border-slate-700 transition-colors flex items-center justify-center"
                    title="Bỏ qua đề xuất"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
