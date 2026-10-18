# TokenTracker — Security Scan (trial run, OSS Scanner pattern)

- Repo: https://github.com/pitimon/TokenTracker @ `33c87e5` (main, 17 ต.ค. 2026)
- วันที่สแกน: 18 ต.ค. 2026 (เวลาไทย) · วิธี: รอบแรกอ่านโค้ดแบบ sink-driven + รอบสองตรวจเชิงลึก (รันเซิร์ฟเวอร์ทดสอบจริง, fuzz parsers, ไล่ตรวจ data flow ในชั้น render)
- ขอบเขต: src/ (CLI + local API), dashboard/src, จุด parse ไฟล์ session จาก 22 เครื่องมือ, sync/queue, การเรียก process ภายนอก — ไม่รวม archive/ และยังไม่ใช่การ fuzz หรือรันโจมตีสด
- Threat model ที่ใช้ตัดสิน severity: แอป local-first บนเครื่องผู้ใช้คนเดียว ข้อมูล usage/cost เป็นข้อมูลอ่อนไหวระดับกลาง (เห็นพฤติกรรมการทำงานและต้นทุน) ตัวคุกคามหลักคือ (ก) เว็บไซต์อันตรายในเบราว์เซอร์ของผู้ใช้ที่พยายามคุยกับ local server (DNS rebinding / CSRF), (ข) ไฟล์ session ที่ถูกสร้างมาอย่างประสงค์ร้าย (เช่น มากับ repo ที่ clone มา) ผ่าน parsers, (ค) โปรเซสอื่นบนเครื่องเดียวกัน (ยอมรับความเสี่ยงระดับ local-app ทั่วไป)

## ผลสรุป

**ไม่พบช่องโหว่ที่ยืนยันได้ในรอบนี้** — ฐานโค้ดมีวินัยความปลอดภัยสูงกว่าค่าเฉลี่ยอย่างชัดเจน และหลายจุดที่มักเป็นปัญหาในแอปประเภทนี้ถูกป้องกันไว้แล้วพร้อมเทสต์เฉพาะทาง

## จุดที่ตรวจและยืนยันว่าป้องกันดีแล้ว

1. **Bind เฉพาะ loopback** — เซิร์ฟเวอร์ dashboard/API bind `127.0.0.1` เป็นค่าตั้งต้น (`src/commands/serve.js`: `LOCAL_BIND_HOST = "127.0.0.1"`) และมีเทสต์ `serve-bind-host` ล็อกพฤติกรรมนี้
2. **Mutation ต้องมี token + Origin** — การเขียนผ่าน local API ต้องใช้ token สุ่มต่อโปรเซส (`crypto.randomBytes(24)`) ใน header/cookie **และ** Origin ต้องเป็น loopback (`isAuthorizedLocalMutation` ใน `src/lib/local-api.js`) — กัน CSRF จากเว็บไซต์ภายนอกตามแบบที่ถูกต้อง
3. **Proxy ถูกจำกัดอย่างรัดกุม** — `/proxy/ipcheck` (ต่อไป ip.net.coffee): GET/HEAD เท่านั้น, allowlist ของ path prefixes, ไม่ส่งต่อ credentials/headers ที่ fingerprint ได้, มีการกันปลายทางภายใน (คอมเมนต์ในโค้ดระบุ 169.254.169.254 และความเสี่ยง port-probing ไว้ชัดเจน); avatar-proxy บังคับ content-type เป็น `image/*` เท่านั้น
4. **การเรียก process ภายนอกไม่มี shell interpolation** — ใช้ `execFileSync`/`spawnSync` แบบ argument array (เช่น sqlite3 CLI ใน `src/lib/sqlite-reader.js`) และ runner ถูก inject ได้เพื่อการทดสอบ
5. **Dashboard ไม่มี innerHTML sinks** — grep ใน dashboard/src ไม่พบการใช้ innerHTML กับข้อมูลที่ parse มา ลดความเสี่ยง stored XSS จากเนื้อหา transcript
6. **Sync เป็น local aggregation** — `src/commands/sync.js` อ่านไฟล์ session ของแต่ละเครื่องมือมารวมลง queue ในเครื่อง (`~/.tokentracker/tracker/queue.jsonl`) ไม่พบเส้นส่งข้อมูลออก network ในเส้นทางที่ตรวจ และ repo มีเทสต์ `outbound-inventory` คุมจุดออก network โดยเฉพาะ

## รอบตรวจเชิงลึก (18 ต.ค. 2026 — ปิดครบทั้ง 3 จุดที่รอบแรกค้างไว้)

### Probe 1: `/api/local-auth`, CORS และ Host validation — ✅ ป้องกันครบ (ยืนยันด้วยการรันเซิร์ฟเวอร์จริง)
- **Host-header allowlist** ทำงานก่อนทุกอย่างใน `src/commands/serve.js` (`isAllowedHostHeader`): ยอมเฉพาะ host ที่เป็น loopback, ปฏิเสธรูปแบบหลอก (userinfo `@`, control characters, host ภายนอก) — เป็นการแก้ที่อ้างถึง Issue #88 (DNS rebinding) โดยเฉพาะ และยังมีตัวกัน request-target แบบ absolute-form/`//host` ไม่ให้ routing กับตัวตรวจเห็น authority คนละตัว
- **ทดสอบสด 7 กรณี**: ปกติ 200; Host เป็นโดเมนภายนอก → **403** ทั้ง endpoint token และ read endpoint; Host แบบ userinfo (`x@127.0.0.1`) → **403**; Host `localhost.` (FQDN trailing dot) → 200 ตามที่ออกแบบและมีคอมเมนต์อธิบายไว้
- **CORS**: preflight ตอบ 204 โดยมี Allow-Methods/Allow-Headers แต่**ไม่มี Access-Control-Allow-Origin** — เบราว์เซอร์จึงอ่าน response ข้าม origin ไม่ได้ ส่วน mutation ยังต้องมี token + Origin เป็น loopback อีกชั้น
- ข้อจำกัดตามการออกแบบ (ไม่ใช่ช่องโหว่): โปรเซสใด ๆ บนเครื่องเดียวกันขอ token จาก `/api/local-auth` ได้ — เป็น tradeoff มาตรฐานของ local app และอยู่นอก threat model ที่ตั้งไว้

### Probe 2: ความทนทานของ parsers — ✅ ผ่านการ fuzz (ไม่พบปัญหา)
- รัน parser จริง (`parseRolloutIncremental`, `parseClaudeIncremental`) กับไฟล์ที่สร้างอย่างประสงค์ร้าย: บรรทัดขยะ 30 MB, JSON ซ้อนลึก 20,000 ชั้น, ค่า `1e999`/ลบ/ชนิดข้อมูลผิด, JSON ตัดขาด, UTF-8 เสีย, การฝัง `__proto__` 4 ตำแหน่ง — ผล: ประมวลผลจบใน **169 ms / 33 ms**, นับเฉพาะ event ที่ถูกต้อง, **ไม่เกิด prototype pollution** (`Object.prototype` สะอาดหลังรัน), ไม่ throw, หน่วยความจำไม่พอง (RSS ~130 MB ทั้งโปรเซส)
- ตัวอ่าน SQLite (`readSqliteJsonRowsWithStatus`): ไฟล์ขยะ/ไฟล์ตัดขาด/ไฟล์ไม่มีอยู่ → คืนสถานะ typed (`unreadable`/`missing`) ไม่ throw (หมายเหตุ: `SELECT 1` บนไฟล์ขยะคืน ok เพราะ query ไม่แตะ schema — พฤติกรรมของ sqlite3 CLI เอง ไม่ใช่ช่องโหว่)

### Probe 3: การ escape ในชั้น render — ✅ มีวินัยครบ จุดเสี่ยงจริงถูกกันไว้
- คำสั่ง `wrapped` render เป็น **ASCII text** เท่านั้น ไม่มีพื้นผิว HTML; dashboard เป็น React (escape อัตโนมัติ) ทุกหน้ายกเว้น **IpCheckPage** ที่ใช้ innerHTML กับข้อมูลจาก upstream (ip.net.coffee) — จุดเสี่ยง stored XSS ที่แท้จริงของระบบ
- ตรวจแล้ว: หน้านี้มี `esc()` (escape ครบ & < > " ') และบังคับใช้กับทุกค่าจาก upstream — region/city/ASN/org escape, company type ผ่าน allowlist map หรือ esc(), country code ตรวจด้วย `^[a-zA-Z]{2}$` ก่อนสร้าง URL ธง, ค่า trust score ตรวจ `typeof number` ก่อนแสดง, ข้อมูลที่วนผ่าน localStorage ถูกปฏิบัติเป็น tainted เสมอ, แม้แต่ค่าในเครื่อง (user agent/WebGL) ยัง esc() แบบ defense-in-depth และมีคอมเมนต์ในโค้ดระบุเหตุผลด้านความปลอดภัยไว้ตรงจุด

## ข้อเสนอถ้าจะทำเป็นวงจรประจำ

- เก็บเคสทดสอบของรอบเชิงลึกนี้ (rebinding 7 กรณี, fuzz corpus ของ parsers) เป็น regression tests ตามแนว config-evals (incident → eval) — โค้ดเบสนี้มีวัฒนธรรมนั้นอยู่แล้ว (เทสต์อ้าง Issue #88 โดยตรง) การเพิ่มจึงต่อยอดของเดิม ไม่ใช่ของใหม่
- ผูก static scanner เชิง deterministic (Semgrep ruleset สำหรับ Node) เข้า CI เป็นชั้นกรองคู่กับรอบ agentic

*หมายเหตุ: รายงานนี้เป็นการทดลองทำตามแพตเทิร์น OSS Scanner (threat model → สแกน → ตรวจทาน → รายงานพร้อมหลักฐาน) โดยเอเจนต์เดียวสองรอบตรวจ ขอบเขตยังน้อยกว่าบริการต้นแบบที่ใช้หลายเอเจนต์และงบ token สูงกว่ามาก และยังไม่ครอบคลุมการไล่อ่านโค้ดทุกบรรทัดของ parser ขนาดใหญ่ (`rollout.js` ~9,300 บรรทัด) — ผล "ไม่พบ" จึงหมายถึงไม่พบในขอบเขตและวิธีที่ระบุ ไม่ใช่การรับรองว่าไม่มีช่องโหว่*
