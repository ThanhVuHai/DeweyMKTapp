# Ads Command Center

**Ads Command Center** là một ứng dụng quản lý dashboard báo cáo quảng cáo Facebook/Meta Ads toàn diện, được thiết kế cho các Đội ngũ Marketing (Marketing Manager, Ads Specialist, và Content Team) để theo dõi hiệu quả chi phí, phân tích hiệu suất nội dung sáng tạo theo phễu chuyển đổi, và đề xuất hành động tối ưu hóa ngân sách tiếp theo (Next Action Recommendations) dựa trên các chỉ số KPI thực tế.

---

## 🚀 Tính Năng Nổi Bật

1. **Dashboard Tổng Quan (Overview)**: Theo dõi chi phí, leads, Qualified Leads (QL), Waiting List (WL), CPL, CTR, CPM, và tốc độ tiêu ngân sách (Pacing Gap) so với KPI tháng.
2. **Dashboard Executive**: Dành cho Marketing Manager để theo dõi tỷ lệ đạt mục tiêu KPI, hiệu quả chi tiết của từng Cơ sở (Campus) & Khối lớp (Grade), so sánh hiệu quả kênh và phê duyệt các đề xuất hành động tiếp theo.
3. **Quản Lý Tối Ưu Ads (Ads Optimization)**: Bảng thống kê chi tiết ở 3 cấp độ (Campaigns, Ad Sets, Ads) kèm cảnh báo lỗi mỏi quảng cáo, CPL đắt, CTR thấp. Click vào dòng mở Slide-out Drawer xem chi tiết cấu trúc Creative, xu hướng, và lưu ghi chú.
4. **Phân Tích Hiệu Suất Content**: Phân tích sâu hiệu quả nội dung theo Content ID, Phễu chuyển đổi (TOFU/MOFU/BOFU), Hook Type, và Format (Video, Image, Carousel). Hỗ trợ gắn nhãn phân loại nhanh (*Mark as Win, Scale, Fail*).
5. **Phân Tích Phễu Chuyển Đổi (Funnel Analysis)**: Trực quan hóa tỷ lệ rơi rụng qua 7 bước khách hàng đi qua và tự động đưa ra các chẩn đoán nút thắt cổ chai của hệ thống (Troubleshooting Diagnostics).
6. **Bảo Mật Meta Token & Credentials**: Mã hóa đối xứng token bằng chuẩn `AES-256-CBC` trước khi lưu vào DB. Không hiển thị plaintext token ở frontend, che mặt token hiển thị dạng `EAAB************xyz`.

---

## 🛠️ Công Nghệ Sử Dụng

- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS, Lucide Icons
- **Charts / Tables**: Recharts
- **Database / ORM**: SQLite (mặc định chạy local không cần setup) / PostgreSQL, Prisma ORM
- **Testing**: Node.js Native Runner (`node --test`), `tsx` loader

---

## 📂 Cấu Trúc Thư Mục Dự Án

```text
/DeweyMKTapp
├── /prisma
│   └── schema.prisma         # Cấu hình Database & Model Prisma (SQLite)
├── /src
│   ├── /app
│   │   ├── /api              # Các API Endpoints nội bộ (auth, meta, sync, dashboard, kpis, mappings)
│   │   ├── globals.css       # Style Tailwind & Drawer keyframe animations
│   │   ├── layout.tsx        # Cấu hình base layout font
│   │   └── page.tsx          # Giao diện Dashboard SPA chính, tích hợp sidebar và filters
│   ├── /components           # Các Tab views của Dashboard
│   │   ├── OverviewTab.tsx   # Dashboard Tổng quan
│   │   ├── ExecutiveTab.tsx  # Dashboard Quản lý & duyệt hành động
│   │   ├── OptimizationTab.tsx# Bảng tối ưu Ads & detail Drawer
│   │   ├── ContentTab.tsx    # Phân tích sáng tạo content & library
│   │   ├── FunnelTab.tsx     # Biểu đồ phễu & chẩn đoán lỗi
│   │   ├── KpiTab.tsx        # Quản lý KPI mục tiêu hàng tháng
│   │   ├── MappingTab.tsx    # Quản lý gắn nhãn & auto-parse naming
│   │   ├── ConnectionTab.tsx # Quản lý Meta API & test connection
│   │   └── AuditTab.tsx      # Xem lịch sử Audit logs của admin
│   └── /lib
│       ├── db.ts             # Prisma client connection singleton
│       ├── crypto.ts         # Mã hóa AES-256-CBC cho Meta Access Token
│       ├── metrics.ts        # Các công thức tính toán marketing & format số liệu
│       ├── recommendations.ts# Động cơ phân tích rule-based gợi ý hành động
│       └── seedData.ts       # Module sinh nạp dữ liệu Mock cho Demo Mode
├── /tests                    # Các file kiểm thử unit test
│   ├── metrics.test.ts
│   └── recommendations.test.ts
├── .env                      # File cấu hình môi trường chứa khóa encryption
├── package.json              # Quản lý thư viện cài đặt
└── README.md                 # Tài liệu hướng dẫn sử dụng
```

---

## 🔧 Hướng Dẫn Chạy Local

### 1. Cài đặt các thư viện phụ thuộc
Mở terminal tại thư mục dự án và chạy lệnh:
```bash
npm install
```

### 2. Thiết lập Database SQLite
Chạy lệnh Prisma để khởi tạo database file `dev.db` tự động và compile Prisma Client:
```bash
npx prisma db push
```

### 3. Khởi chạy Server Phát Triển
Chạy dev server cục bộ:
```bash
npm run dev
```
Dự án sẽ hoạt động tại địa chỉ: [http://localhost:3000](http://localhost:3000).

### 4. Chạy Unit Tests
Để chạy bộ kiểm thử kiểm tra độ chính xác của các công thức tính toán marketing và động cơ khuyến nghị:
```bash
npm test
```
*(Hoặc chạy lệnh: `npx tsx --test tests/metrics.test.ts tests/recommendations.test.ts`)*

---

## 💡 Hướng Dẫn Sử Dụng Dashboard

### 1. Trải Nghiệm Nhanh Bằng Demo Mode (Khuyên Dùng)
Khi mới chạy ứng dụng, database sẽ trống trơn. Để trải nghiệm ngay toàn bộ các tính năng với dữ liệu mô phỏng chân thực nhất:
- Mở Dashboard trên trình duyệt.
- Bấm nút **Seed Demo Data** ở góc dưới cùng của Sidebar bên trái.
- Ứng dụng sẽ nạp khoảng 30 ngày dữ liệu chiến dịch quảng cáo mẫu, KPIs, Leads từ CRM và các cảnh báo hành động vào DB.
- Các biểu đồ, bảng biểu tối ưu hóa, phễu chuyển đổi sẽ hiển thị đầy đủ ngay lập tức!

### 2. Trải Nghiệm Phân Quyền (RBAC)
Trên thanh Topbar có một dropdown **Role: Admin**. Bạn có thể nhấp chọn để chuyển đổi nhanh vai trò:
- **Admin**: Xem toàn bộ, cấu hình Meta API Connection, KPI Settings, Content Mappings, xem Audit Logs.
- **Manager**: Xem toàn bộ dashboard, duyệt/bỏ qua các đề xuất Next Actions. (Ẩn trang Meta API Settings).
- **Ads Specialist**: Theo dõi chi tiết Ads Optimization, thêm ghi chú trong Drawer, tự động parse Naming Convention.
- **Content**: Xem Content Performance, đánh nhãn Win/Scale/Fail cho creative bài viết. (Ẩn các trang KPI & Connection).
- **Viewer**: Chỉ xem số liệu, không thể sửa đổi hay tương tác.

### 3. Kết Nối Meta API Thực Tế
Nếu bạn muốn kết nối với tài khoản quảng cáo Meta thật của bạn:
1. Truy cập tab **Meta API Settings** (Yêu cầu chọn vai trò **Admin** trên Topbar).
2. Nhập các thông tin:
   - **Access Token**: Token được cấp từ trang Facebook Developer portal (yêu cầu quyền `ads_read`).
   - **Ad Account ID**: ID tài khoản quảng cáo của bạn (ví dụ: `act_123456789`).
   - **Ngày bắt đầu Sync**: Ngày lịch sử muốn lấy dữ liệu.
3. Nhấp **Lưu kết nối**.
4. Bấm **Test Connection (Xác thực)** để kiểm tra tính hợp lệ của token. Nếu kết nối thành công, hệ thống sẽ hiển thị tên tài khoản, tiền tệ (VND/USD), múi giờ và đổi trạng thái kết nối sang màu xanh `connected`.
5. Bấm **Đồng bộ Accounts** để lưu thông tin tài khoản quảng cáo vào database.
6. Bấm **Sync Now** ở Topbar để kích hoạt tiến trình đồng bộ dữ liệu chiến dịch, quảng cáo và insights chi tiết theo ngày vào database.

---

## 🔒 Quy Định Đặt Tên Naming Convention Để Auto-Parse Mappings
Content Team có thể đặt tên các mẫu quảng cáo (Ad Name) trên Facebook Ads Manager theo quy tắc:
`[Campus]_[Grade]_[Funnel]_[Angle]_[Format]_[Offer]_[ContentID]`

Ví dụ:
- `CG_G6_MOFU_IBOBJECTION_VIDEO_NA_C012`
- `THT_G1_TOFU_TRANSITION_IMAGE_20OFF_C034`
- `HP_G10_BOFU_SCHOLARSHIP_CAROUSEL_TOUR_C087`

Tại tab **Content Mapping**, nhấp chọn **Tự động nhận diện (Naming Convention)**, hệ thống sẽ tự động quét tất cả các Ads đã sync từ API về, parse chuỗi tên adName theo dấu gạch dưới `_` và tự động gắn nhãn phân bổ cho các chiến dịch tương ứng mà bạn không cần phải nhập thủ công!
"# DeweyMKTapp" 
