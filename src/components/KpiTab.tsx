'use client';

import React from 'react';
import { Target, Plus, Trash2, Calendar, ShieldAlert, Check } from 'lucide-react';
import { formatVND, formatNumber } from '@/lib/metrics';

interface KpiTabProps {
  currentRole: string;
  triggerRefresh: number;
  onRefresh: () => void;
}

export default function KpiTab({ currentRole, triggerRefresh, onRefresh }: KpiTabProps) {
  const [kpis, setKpis] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Form states
  const [month, setMonth] = React.useState(6);
  const [year, setYear] = React.useState(2026);
  const [campus, setCampus] = React.useState('CG');
  const [grade, setGrade] = React.useState('G6');
  const [source, setSource] = React.useState('LeadAds');
  
  const [targetLeads, setTargetLeads] = React.useState(100);
  const [targetQL, setTargetQL] = React.useState(30);
  const [targetWL, setTargetWL] = React.useState(10);
  const [monthlyBudget, setMonthlyBudget] = React.useState(20000000);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    async function fetchKpis() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/kpis');
        const result = await res.json();
        if (result.error) {
          setError(result.error);
        } else {
          setKpis(result.kpis || []);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch KPIs');
      } finally {
        setLoading(false);
      }
    }
    fetchKpis();
  }, [triggerRefresh]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!['admin', 'manager'].includes(currentRole)) {
      alert('Tài khoản của bạn không có quyền ghi cấu hình KPI.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/kpis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          year,
          campus,
          grade,
          source,
          targetLeads,
          targetQualifiedLeads: targetQL,
          targetWl: targetWL,
          monthlyBudget,
        }),
      });

      const result = await res.json();
      if (result.success) {
        onRefresh(); // reload parent
        alert('Cấu hình KPI Target được lưu thành công!');
      } else {
        alert(result.error || 'Failed to save KPI');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!['admin', 'manager'].includes(currentRole)) {
      alert('Tài khoản của bạn không có quyền xóa KPI Target.');
      return;
    }
    if (!confirm('Bạn có chắc chắn muốn xóa mục tiêu KPI này?')) return;

    try {
      const res = await fetch(`/api/kpis/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        onRefresh();
      } else {
        alert(result.error || 'Failed to delete KPI');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const canWrite = ['admin', 'manager'].includes(currentRole);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* KPI Form Add (Only for Admin/Manager) */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl space-y-4">
        <div>
          <h3 className="font-extrabold text-lg text-slate-200 flex items-center">
            <Target className="w-5 h-5 text-indigo-400 mr-2" /> Thiết lập mục tiêu KPI
          </h3>
          <p className="text-xs text-slate-500">Thêm hoặc cập nhật mục tiêu hàng tháng cho từng cơ sở và khối học</p>
        </div>

        {!canWrite && (
          <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-3xs text-rose-300 flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4" /> <span>Chỉ có vai trò Admin/Manager mới sửa được KPIs.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1.5 uppercase">Tháng</label>
              <select
                value={month}
                onChange={e => setMonth(Number(e.target.value))}
                disabled={!canWrite}
                className="w-full px-3.5 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                  <option key={m} value={m}>Tháng {m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1.5 uppercase">Năm</label>
              <select
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                disabled={!canWrite}
                className="w-full px-3.5 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1.5 uppercase">Cơ sở</label>
              <select
                value={campus}
                onChange={e => setCampus(e.target.value)}
                disabled={!canWrite}
                className="w-full px-3.5 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="CG">CG (Cầu Giấy)</option>
                <option value="THT">THT (Tây Hồ T.)</option>
                <option value="HP">HP (Hải Phòng)</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1.5 uppercase">Khối</label>
              <select
                value={grade}
                onChange={e => setGrade(e.target.value)}
                disabled={!canWrite}
                className="w-full px-3.5 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="G1">G1 (Lớp 1)</option>
                <option value="G6">G6 (Lớp 6)</option>
                <option value="G10">G10 (Lớp 10)</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1.5 uppercase">Nguồn (Source)</label>
              <select
                value={source}
                onChange={e => setSource(e.target.value)}
                disabled={!canWrite}
                className="w-full px-3.5 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="LeadAds">LeadAds</option>
                <option value="Messenger">Messenger</option>
                <option value="Conversion">Conversion</option>
              </select>
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-850 pt-4">
            <div>
              <label className="text-slate-400 text-3xs font-semibold block mb-1.5 uppercase">Ngân sách dự kiến (VND)</label>
              <input
                type="number"
                value={monthlyBudget}
                onChange={e => setMonthlyBudget(Number(e.target.value))}
                disabled={!canWrite}
                className="w-full px-3.5 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500 font-bold"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-slate-400 text-3xs font-semibold block mb-1.5 uppercase">Target Leads</label>
                <input
                  type="number"
                  value={targetLeads}
                  onChange={e => setTargetLeads(Number(e.target.value))}
                  disabled={!canWrite}
                  className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-slate-400 text-3xs font-semibold block mb-1.5 uppercase">Target QL</label>
                <input
                  type="number"
                  value={targetQL}
                  onChange={e => setTargetQL(Number(e.target.value))}
                  disabled={!canWrite}
                  className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-slate-400 text-3xs font-semibold block mb-1.5 uppercase">Target WL</label>
                <input
                  type="number"
                  value={targetWL}
                  onChange={e => setTargetWL(Number(e.target.value))}
                  disabled={!canWrite}
                  className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !canWrite}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold shadow-lg transition-colors flex items-center justify-center space-x-2"
          >
            <Plus className="w-4 h-4" /> <span>Lưu KPI Target</span>
          </button>
        </form>
      </div>

      {/* KPI List Table */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl lg:col-span-2 space-y-4">
        <div>
          <h3 className="font-extrabold text-lg text-slate-200 flex items-center">
            <Calendar className="w-5 h-5 text-indigo-400 mr-2" /> Bảng phân bổ KPI Target
          </h3>
          <p className="text-xs text-slate-500">Mục tiêu chiến dịch đang được áp dụng trong cơ sở dữ liệu</p>
        </div>

        {loading ? (
          <div className="text-center py-10 text-slate-500 text-xs animate-pulse">Đang tải KPIs...</div>
        ) : error ? (
          <div className="text-xs text-rose-400">{error}</div>
        ) : kpis.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-xs border border-dashed border-slate-850 rounded-2xl">
            Không tìm thấy KPI target nào. Hãy nhập dòng đầu tiên!
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[460px]">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="text-3xs text-slate-500 uppercase bg-slate-950/20 border-b border-slate-800/60">
                <tr>
                  <th className="py-3 px-4 font-semibold">Giai đoạn</th>
                  <th className="py-3 px-4 font-semibold">Cơ sở</th>
                  <th className="py-3 px-4 font-semibold">Khối</th>
                  <th className="py-3 px-4 font-semibold">Nguồn</th>
                  <th className="py-3 px-4 text-right font-semibold">Ngân sách</th>
                  <th className="py-3 px-4 text-right font-semibold">Target Leads</th>
                  <th className="py-3 px-4 text-right font-semibold">QL</th>
                  {canWrite && <th className="py-3 px-4"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-slate-350">
                {kpis.map((k: any) => (
                  <tr key={k.id} className="hover:bg-slate-800/10">
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-200">
                      {k.month.toString().padStart(2, '0')}/{k.year}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-300">{k.campus}</td>
                    <td className="py-2.5 px-4">{k.grade}</td>
                    <td className="py-2.5 px-4 font-bold text-slate-400">{k.source}</td>
                    <td className="py-2.5 px-4 text-right font-medium text-slate-200">{formatVND(k.monthlyBudget)}</td>
                    <td className="py-2.5 px-4 text-right font-black text-slate-100">{k.targetLeads}</td>
                    <td className="py-2.5 px-4 text-right">{k.targetQualifiedLeads}</td>
                    {canWrite && (
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => handleDelete(k.id)}
                          className="p-1 hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 rounded-lg transition-all"
                          title="Xóa mục tiêu"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
