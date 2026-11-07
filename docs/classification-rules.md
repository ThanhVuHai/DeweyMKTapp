# DeweyMKTapp — Campaign Classification Engine Specification (V1)

## 1. Objective
Define deterministic parsing rules to automatically classify synchronized Meta advertising assets into organizational dimensions for The Dewey Schools.

## 2. Campus Classification Rules
Campus is determined by **CAMPAIGN NAME** (not Ad Set name or Ad name).

### 2.1 Keyword Mapping Rules
| Target Campus | Matching Pattern (Case-Insensitive) | Description |
|---|---|---|
| **HO** | `deweyho` | Head Office / Central Operations |
| **THT** | `deweytht` | Tay Ho Tay Campus |
| **CG** | `deweycg` | Cau Giay Campus |
| **OP** | `deweyop` | Ocean Park Campus |
| **HP** | `deweyhp` | Hai Phong Campus |

### 2.2 Operational Constraints
- Matching is case-insensitive.
- Must match exact token/pattern boundaries (avoid substring misidentification).
- If multiple conflicting campus codes appear in a single Campaign name $\rightarrow$ flag as `CONFLICT`.
- If no campus pattern matches $\rightarrow$ flag as `UNMAPPED`.
- **HO is an independent campus unit**: Under no circumstances should HO be allocated or divided into THT, CG, OP, or HP.
- All Ad Sets and Ads inherit the Campus of their parent Campaign unless an explicit manual override is confirmed.
- Automatic re-classification is triggered when a Campaign name is renamed in Meta, **without overwriting verified manual overrides**.

## 3. Campaign Naming Convention
Campaign names follow the standardized convention:
```
EMPLOYEE_CAMPUS_OBJECTIVE_TS_DATE_CONTENT
```
- **EMPLOYEE**: Responsible staff code (e.g., `NAMNV`, `LINHPT`).
- **CAMPUS**: Campus identifier token (e.g., `DEWEYCG`, `DEWEYTHT`).
- **OBJECTIVE**: Marketing goal (e.g., `MESS`, `LEADADS`, `TRAFFIC`, `REACH`, `VIDEO`).
- **TS**: Enrollment campaign indicator (`TS` = Tuyển sinh).
- **DATE**: Campaign launch date in `DDMMYY` format (e.g., `021126` = 02/11/2026).
- **CONTENT**: Descriptive topic/subject (e.g., `TIENGANH`, `MATH`, `MASTER`).

## 4. Content-Level Classification Rules
Ad names follow the standardized convention:
```
CONTENT_CODE_CONTENT_NAME_NICHE
```
- **CONTENT_CODE**: First segment, formatted as `C[0-9]+[VDIP]?[0-9]*` (e.g., `C46V46`, `C41.2D41.2`, `C012`).
  - Represents the primary creative asset code.
- **CONTENT_NAME**: Second segment, descriptive creative title (e.g., `Video Mastery`, `Adventure KR`).
- **NICHE**: Third segment, target theme or offer angle (e.g., `Chương trình Mastery`, `Tuyển sinh`).

## 5. Grade-Level Status in V1
- The Dewey Schools is currently running **general enrollment campaigns**.
- **Grade-level classification is NOT required for V1**.
- All existing Grade-related database columns (`grade`, `targetGrade`) are preserved in schema for future enrollment cycles.

## 6. Manual Overrides & Immutability
- Users can manually assign or override Campus, Content Code, Angle, or Funnel Stage in the UI.
- When an override is saved, `isManual = true` is set on the mapping record.
- Automated classification sweeps must **never overwrite** any record where `isManual === true`.

