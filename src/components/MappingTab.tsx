'use client';

import React from 'react';
import { Clipboard, ShieldAlert, Sparkles, Edit3, Search, X, Check } from 'lucide-react';

interface MappingTabProps {
  currentRole: string;
  triggerRefresh: number;
  onRefresh: () => void;
}

interface MappedContent {
  id?: string;
  adId?: string;
  contentId?: string | null;
  campus?: string | null;
  grade?: string | null;
  funnelStage?: string | null;
  angle?: string | null;
  hookType?: string | null;
  format?: string | null;
  offer?: string | null;
  note?: string | null;
}

interface AdItemWithMapping {
  id: string;
  name: string;
  contentMapping?: MappedContent | null;
}

export default function MappingTab({ currentRole, triggerRefresh, onRefresh }: MappingTabProps) {
  const [ads, setAds] = React.useState<AdItemWithMapping[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  
  // Search
  const [search, setSearch] = React.useState('');
  
  // Edit Form Modal State
  const [editingAd, setEditingAd] = React.useState<AdItemWithMapping | null>(null);
  const [contentId, setContentId] = React.useState('');
  const [campus, setCampus] = React.useState('CG');
  const [grade, setGrade] = React.useState('G6');
  const [funnelStage, setFunnelStage] = React.useState('TOFU');
  const [angle, setAngle] = React.useState('');
  const [hookType, setHookType] = React.useState('QUESTION');
  const [format, setFormat] = React.useState('VIDEO');
  const [offer, setOffer] = React.useState('');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [autoParsing, setAutoParsing] = React.useState(false);

  React.useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // Fetch ads from API to map
        // In MVP, we query Ads and join on frontend with Content Mappings
        const adsRes = await fetch('/api/dashboard/ads-optimization?level=ad');
        const adsData = (await adsRes.json()) as { data?: AdItemWithMapping[]; error?: string };

        if (adsData.error) {
          setError(adsData.error);
        } else {
          setAds(adsData.data || []);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to fetch content mapping structures';
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [triggerRefresh]);

  const handleOpenEdit = (item: AdItemWithMapping) => {
    setEditingAd(item);
    // Populate form with existing mapping if any
    const existing = item.contentMapping;
    if (existing) {
      setContentId(existing.contentId || '');
      setCampus(existing.campus || 'CG');
      setGrade(existing.grade || 'G6');
      setFunnelStage(existing.funnelStage || 'TOFU');
      setAngle(existing.angle || '');
      setHookType(existing.hookType || 'QUESTION');
      setFormat(existing.format || 'VIDEO');
      setOffer(existing.offer || '');
      setNote(existing.note || '');
    } else {
      // Clear form for new
      setContentId('');
      setCampus('CG');
      setGrade('G6');
      setFunnelStage('TOFU');
      setAngle('');
      setHookType('QUESTION');
      setFormat('VIDEO');
      setOffer('');
      setNote('');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAd) return;
    if (!['admin', 'manager', 'ads_specialist', 'content'].includes(currentRole)) {
      alert('Tài khoản của bạn không có quyền sửa Content Mappings.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/content-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: editingAd.id,
          contentId,
          campus,
          grade,
          funnelStage,
          angle,
          hookType,
          format,
          offer,
          note,
        }),
      });

      const result = await res.json();
      if (result.success) {
        setEditingAd(null);
        onRefresh(); // Refresh list
        alert('Cấu hình Content Mapping đã được cập nhật thành công!');
      } else {
        alert(result.error || 'Failed to save mapping');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutoParse = async () => {
    if (autoParsing) return;
    setAutoParsing(true);
    try {
      const res = await fetch('/api/content-mappings/auto-parse', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        onRefresh();
        alert(result.message || 'Tự động phân tích hoàn tất!');
      } else {
        alert(result.error || 'Auto-parsing failed');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + message);
    } finally {
      setAutoParsing(false);
    }
  };

  // Filter ads by search
  const filteredAds = ads.filter(ad => 
    ad.name.toLowerCase().includes(search.toLowerCase()) || 
    ad.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Panel */}
      <div className="flex justify-between items-center bg-slate-900/60 p-6 rounded-3xl border border-slate-800/80 shadow-xl">
        <div className="space-y-1">
          <h3 className="font-extrabold text-lg text-slate-200 flex items-center">
            <Clipboard className="w-5 h-5 text-indigo-400 mr-2" /> Quản lý danh mục bài viết (Content Mapping)
          </h3>
          <p className="text-xs text-slate-500">Gắn nhãn định danh chiến dịch, phễu, định dạng và ưu đãi để phục vụ phân tích</p>
        </div>

        <button
          onClick={handleAutoParse}
          disabled={autoParsing}
          className="flex items-center space-x-1.5 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-650 transition-all border border-indigo-500/20"
        >
          <Sparkles className="w-4.5 h-4.5 text-indigo-100" />
          <span>{autoParsing ? 'Đang phân tích...' : 'Tự động nhận diện (Naming Convention)'}</span>
        </button>
      </div>

      {/* Local Filter Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900/20 p-4 rounded-2xl border border-slate-850">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Tìm mẫu Ads cần mapping..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Main mapping list */}
      {loading ? (
        <div className="text-center py-20 text-slate-500 animate-pulse text-xs">Đang tải cấu trúc tài khoản quảng cáo...</div>
      ) : error ? (
        <div className="bg-red-950/20 border border-red-500/50 text-red-200 p-6 rounded-2xl flex items-center space-x-3 text-xs">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
          <span>Lỗi: {error}</span>
        </div>
      ) : filteredAds.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-850 rounded-3xl text-slate-500 text-xs">
          Không tìm thấy Ads nào chưa được mapping.
        </div>
      ) : (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="text-3xs text-slate-500 uppercase tracking-wider bg-slate-950/20 border-b border-slate-800/60">
                <tr>
                  <th className="py-4.5 px-6 font-semibold">Tên Ads</th>
                  <th className="py-4.5 px-6 font-semibold">Content ID</th>
                  <th className="py-4.5 px-6 font-semibold">Cơ sở (Campus)</th>
                  <th className="py-4.5 px-6 font-semibold">Khối (Grade)</th>
                  <th className="py-4.5 px-6 font-semibold">Phân khúc phễu</th>
                  <th className="py-4.5 px-6 font-semibold">Content Angle</th>
                  <th className="py-4.5 px-6 font-semibold">Định dạng (Format)</th>
                  <th className="py-4.5 px-6 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-slate-350">
                {filteredAds.map((item: AdItemWithMapping) => {
                  const mapping = item.contentMapping;
                  const hasMapping = !!mapping && !!mapping.contentId;

                  return (
                    <tr key={item.id} className="hover:bg-slate-800/10">
                      <td className="py-4 px-6 max-w-xs truncate">
                        <span className="font-bold text-slate-200 block truncate" title={item.name}>{item.name}</span>
                        <span className="text-3xs text-slate-500 block font-mono">Ad ID: {item.id}</span>
                      </td>
                      <td className="py-4 px-6">
                        {hasMapping ? (
                          <span className="font-black text-slate-200">{mapping.contentId}</span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 text-3xs font-extrabold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full">
                            Chưa Mapping
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6 font-semibold text-slate-300">{mapping?.campus || '-'}</td>
                      <td className="py-4 px-6">{mapping?.grade || '-'}</td>
                      <td className="py-4 px-6 font-bold text-teal-400">{mapping?.funnelStage || '-'}</td>
                      <td className="py-4 px-6 text-slate-400 italic">{mapping?.angle || '-'}</td>
                      <td className="py-4 px-6 font-semibold text-indigo-400">{mapping?.format || '-'}</td>
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => handleOpenEdit(item)}
                          className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-3xs font-bold transition-all"
                        >
                          <Edit3 className="w-3 h-3" /> <span>Cấu hình</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EDIT mapping MODAL */}
      {editingAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div onClick={() => setEditingAd(null)} className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
          
          <div className="relative bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-4 z-10 animate-fade-in">
            <div className="flex justify-between items-start border-b border-slate-850 pb-3">
              <div>
                <h4 className="font-extrabold text-sm text-slate-200">Gắn nhãn Ads Metadata</h4>
                <p className="text-3xs text-slate-500 max-w-[280px] truncate">Ad: {editingAd.name}</p>
              </div>
              <button 
                onClick={() => setEditingAd(null)}
                className="p-1 bg-slate-950/40 border border-slate-800 hover:bg-slate-800 text-slate-400 rounded-lg transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-500 text-3xs font-semibold block mb-1 uppercase">Content ID</label>
                  <input
                    type="text"
                    value={contentId}
                    onChange={e => setContentId(e.target.value)}
                    placeholder="Ví dụ: C012"
                    className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500 font-bold"
                  />
                </div>
                <div>
                  <label className="text-slate-500 text-3xs font-semibold block mb-1 uppercase">Phân khúc Phễu</label>
                  <select
                    value={funnelStage}
                    onChange={e => setFunnelStage(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500 font-bold"
                  >
                    <option value="TOFU">TOFU (Nhận diện)</option>
                    <option value="MOFU">MOFU (Cân nhắc)</option>
                    <option value="BOFU">BOFU (Chuyển đổi)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-500 text-3xs font-semibold block mb-1 uppercase">Cơ sở (Campus)</label>
                  <select
                    value={campus}
                    onChange={e => setCampus(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="CG">CG</option>
                    <option value="THT">THT</option>
                    <option value="HP">HP</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 text-3xs font-semibold block mb-1 uppercase">Khối học</label>
                  <select
                    value={grade}
                    onChange={e => setGrade(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="G1">G1</option>
                    <option value="G6">G6</option>
                    <option value="G10">G10</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 text-3xs font-semibold block mb-1 uppercase">Định dạng</label>
                  <select
                    value={format}
                    onChange={e => setFormat(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="VIDEO">VIDEO</option>
                    <option value="IMAGE">IMAGE</option>
                    <option value="CAROUSEL">CAROUSEL</option>
                    <option value="TEXT-ONLY">TEXT</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-500 text-3xs font-semibold block mb-1 uppercase">Content Angle</label>
                  <input
                    type="text"
                    value={angle}
                    onChange={e => setAngle(e.target.value)}
                    placeholder="Ví dụ: IBOBJECTION"
                    className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-500 text-3xs font-semibold block mb-1 uppercase">Loại Hook</label>
                  <select
                    value={hookType}
                    onChange={e => setHookType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
                  >
                    <option value="QUESTION">QUESTION (Câu hỏi)</option>
                    <option value="STORY">STORY (Kể chuyện)</option>
                    <option value="CONTRAST">CONTRAST (Phản biện)</option>
                    <option value="STATISTICS">STATS (Số liệu)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-500 text-3xs font-semibold block mb-1 uppercase">Quà tặng / Ưu đãi (Offer)</label>
                <input
                  type="text"
                  value={offer}
                  onChange={e => setOffer(e.target.value)}
                  placeholder="Ví dụ: 20OFF, SCHOLARSHIP..."
                  className="w-full px-3 py-2 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-500 text-3xs font-semibold block mb-1 uppercase">Ghi chú sáng tạo (Note)</label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Ghi chú về angle hoặc hook test..."
                  className="w-full h-16 p-3 bg-slate-950/40 border border-slate-850 rounded-xl text-slate-200 focus:outline-none resize-none"
                />
              </div>

              <div className="flex justify-end space-x-2 border-t border-slate-850 pt-3.5">
                <button
                  type="button"
                  onClick={() => setEditingAd(null)}
                  className="px-4 py-2 font-bold bg-slate-800 text-slate-350 hover:bg-slate-700 rounded-xl transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 disabled:opacity-50 transition-colors flex items-center space-x-1"
                >
                  <Check className="w-4.5 h-4.5" /> <span>Lưu Mapping</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
