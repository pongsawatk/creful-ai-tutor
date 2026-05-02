# Design Reasoning — System Prompt v1.0

ทำไมแต่ละ rule ถึงถูกออกแบบมาแบบนี้

---

## Rule 1: Zero-Tolerance for Numerical Hallucination

### ปัญหาที่แก้:
LLMs มีแนวโน้มสูงที่จะ "ฟังดูถูก" เมื่อตอบตัวเลข เช่น บอกว่า "ระยะหุ้มคอนกรีตเสาทั่วไปคือ 40 มม." — ซึ่ง *อาจจะ* ถูกในบาง context แต่ **ผิดถ้า spec ของโครงการกำหนดไว้ต่างกัน** ในงานก่อสร้าง ตัวเลขที่ "เกือบถูก" = ผิด

### ทำไมต้อง Verbatim:
- **ปัดเศษ**: 4.7% → 5% อาจเปลี่ยนผลการตรวจสอบ pass/fail
- **แปลงหน่วย**: มม. → ซม. อาจผิดพลาดจาก rounding + ช่างอ่านผิดหน่วย
- **คำนวณ**: LLM ไม่ใช่ calculator — arithmetic error ใน safety-critical context = อันตราย
- **ประมาณ/สังเคราะห์**: "chunk A บอก 40, chunk B บอก 50, น่าจะ 45" → catastrophic

### ทำไมต้อง Hard Refusal:
- ข้อความ "ไม่มีข้อมูล...แนะนำให้สอบถามวิศวกรโครงการ" ทำ 3 อย่าง:
  1. **ปฏิเสธชัดเจน** — ไม่ ambiguous
  2. **ชี้ทาง** — ให้ผู้ใช้ไป ask วิศวกร (ซึ่งเป็น correct escalation path ในไซต์)
  3. **รักษาความไว้วางใจ** — ผู้ใช้รู้ว่า bot จะไม่เดา → เมื่อ bot ตอบ = เชื่อได้

### ทำไม Split Response Pattern (ไม่ใช่ปฏิเสธทั้งคำตอบ):

เมื่อคำถามมีทั้ง **concept** (ที่ตอบได้) และ **ตัวเลข** (ที่ไม่อยู่ใน KB) มี 3 ทางเลือก:

| Option | วิธี | ข้อดี | ข้อเสีย |
|--------|------|-------|--------|
| A — Split Response ✅ | ตอบ concept + แยกปฏิเสธตัวเลข | ให้ประโยชน์สูงสุด + ปลอดภัย | ซับซ้อนกว่า, ต้องมี structural separator |
| B — Full Refusal ❌ | ปฏิเสธทั้งคำตอบ | ง่าย, ปลอดภัย 100% | สูญเสียโอกาสสอน, user frustration สูง |
| C — Blended ❌ | ตอบรวมกัน, mention ว่าตัวเลขไม่แน่ใจ | เป็นธรรมชาติ | Risk: ผู้ใช้อ่านข้ามส่วน disclaimer |

**เลือก A เพราะ:**
1. **Maximize utility ภายใต้ safety constraint** — ช่างได้ concept ที่เป็นประโยชน์ ขณะที่ตัวเลขถูก refuse ชัดเจน
2. **`📌 ส่วนตัวเลข:` เป็น visual separator** — ไม่กลืนไปกับเนื้อหา ต่างจาก prose disclaimer ที่ถูกอ่านข้ามง่าย
3. **ลด user frustration** — bot ตอบ "ไม่มีข้อมูล" ทุกครั้ง = ช่างเลิกใช้
4. **Structural enforcement > prose** — "ไม่แน่ใจนะครับ" ถูกข้ามได้ แต่ `📌` block แยกบรรทัดเป็น distinct visual element

**Risk ที่ต้อง mitigate:**
- Bot อาจ "แอบใส่" ตัวเลขในส่วน concept (เช่น "ปกติจะอยู่ที่ประมาณ...") → กฎ §1 ข้อ 4 ห้ามไว้ชัดเจน
- ผู้ใช้อาจคิดว่า concept = เพียงพอสำหรับตัดสินใจ → `📌` block เตือนว่ายังขาดตัวเลข

---

## Rule 2: Hybrid Knowledge Mode

### ปัญหาที่แก้:
ถ้าบังคับ 100% KB-only → bot จะตอบ "ไม่มีข้อมูล" บ่อยเกินไป → user frustration → abandonment
แต่ถ้าปล่อยฟรี → hallucination risk กลับมา

### ทำไมแยก Concept vs. Number:
- **Concept** (นิยาม, หลักการ, เหตุผล) → LLM ตอบได้ดี, risk ต่ำ, มีประโยชน์สูง
- **Number** → LLM ตอบ **ไม่ได้** reliably, risk สูงมาก
- การแยกชัดเจนทำให้ bot มีประโยชน์ **ขณะเดียวกัน** ก็ปลอดภัย

### ทำไมต้อง Citation Block:
- **Transparency** — ผู้ใช้ (และ Trainer) เห็นได้ทันทีว่าคำตอบมาจากไหน
- **XX%** ช่วยให้ผู้ใช้ calibrate trust — "90% จาก KB" vs "30% จาก KB" → พฤติกรรมการใช้ข้อมูลต่างกัน
- **YY%** (self-assessed confidence) เป็น additional signal — แม้ LLM ไม่ได้ calibrated ดีนัก แต่เป็น useful heuristic
- **Warning line เมื่อ XX < 50** — visual alert ที่ชัดเจน ป้องกันการเชื่อข้อมูลที่ไม่ได้มาจากคู่มือ

### ทำไม threshold 50%:
- ต่ำกว่า 50% = คำตอบส่วนใหญ่ไม่ใช่ KB → ควร flag
- 50% เป็น natural "majority" threshold ที่เข้าใจง่าย

---

## Rule 3: Persona — พี่วิศวกรใจดี

### ปัญหาที่แก้:
- **Target user = หัวหน้าช่าง** — ไม่ใช่วิศวกร, ไม่ใช่ผู้จัดการ
- ต้องการ bot ที่ "เข้าถึงได้" แต่ยังคงน่าเชื่อถือ
- ภาษาทางการเกินไป → น่าเบื่อ, ไม่อยากใช้
- ภาษาไม่เป็นทางการเกินไป ("จ้า", "นะคะ") → ดูไม่จริงจัง, ลดความน่าเชื่อถือ

### ทำไมห้าม "นะคะ/จ้า/ค่ะ":
- ภาษาเหล่านี้ให้ความรู้สึก "น้อง customer service" — ไม่เหมาะกับ technical authority
- "ครับ" เป็นกลาง สุภาพ ตรงไปตรงมา เหมาะกับ persona รุ่นพี่วิศวกร

### ทำไม Max 200 คำ:
- ช่างในไซต์ **ไม่มีเวลาอ่านยาว** — กำลังยืนดูงาน, จอมือถือเล็ก, แดดร้อน
- 200 คำ ≈ 1 หน้าจอ iPhone → อ่านจบได้ไม่ต้อง scroll มาก
- ยกเว้น step-by-step procedure ที่จำเป็นต้องละเอียด

### ทำไมใช้ชื่อเล่น:
- สร้าง personal connection → engagement สูงขึ้น
- ช่างรู้สึกว่า bot "จำได้" → trust + continued usage

---

## Rule 4: Escalation Matrix

### ปัญหาที่แก้:
Bot ไม่ควรเป็น single point of contact — มีสถานการณ์ที่ **ต้อง** มีมนุษย์เข้ามาช่วย

### ทำไม 5 triggers นี้:

| Trigger | เหตุผล |
|---------|--------|
| **กฎหมาย/สัญญา** | LLM ให้คำแนะนำทางกฎหมายไม่ได้ — liability risk |
| **Unsafe event** | ต้องมี human response ทันที — bot ไม่สามารถ take action ได้ |
| **KB ขัดแย้ง** | Bot ไม่ควรเลือกข้างเมื่อข้อมูลขัดกัน — ต้องให้ expert ตัดสิน |
| **ถามซ้ำ 3 ครั้ง** | Signal ว่า bot ไม่ตอบโจทย์ → human intervention จะแก้ปัญหาได้ดีกว่า |
| **ตัวเลขนอก KB + ยืนยัน** | ผู้ใช้ต้องการจริงๆ แต่ bot ให้ไม่ได้ → Trainer หาข้อมูลเพิ่มให้ได้ |

### ทำไมใช้ `ESCALATE:` tag:
- **Machine-parseable** — frontend แค่ regex match `^ESCALATE:` แล้วซ่อน + trigger notification
- **ไม่รบกวนผู้ใช้** — ผู้ใช้เห็นแค่คำตอบปกติ, ไม่เห็น tag
- **มี reason ภาษาไทย** — Trainer อ่านแล้วเข้าใจ context ทันที ไม่ต้องอ่าน full conversation

---

## Rule 5: Sliding Window

### ปัญหาที่แก้:
- LLM มี context limit → ต้องจัดการ
- **อันตรายกว่า**: LLM อาจ "จำ" ข้อมูลผิดจาก turn เก่าๆ แล้วตอบซ้ำ — **information decay**

### ทำไม 40 turns:
- 40 turns ≈ 20 Q&A pairs → ครอบคลุม conversation ส่วนใหญ่
- ไม่มากจน context window เต็มก่อน (ต้องเหลือที่ให้ system prompt + KB chunks)
- ถ้า session ยาวกว่า 40 turns → ข้อมูลเก่าอาจ outdated อยู่แล้ว

### ทำไม Re-verify จาก KB:
- ป้องกัน "telephone game" — bot บอก A ใน turn 5, ผู้ใช้ถาม turn 45 ว่า "ที่บอกไป" → bot อาจ recall ผิด
- บังคับ re-retrieve = **ground truth check ทุกครั้ง**
- ถ้าข้อมูลใน KB เปลี่ยน (update) → bot จะได้ข้อมูลล่าสุดเสมอ

---

## Rule 6: Out-of-scope

### ปัญหาที่แก้:
- ป้องกัน bot ตอบเรื่องที่ไม่เชี่ยวชาญ → ลด hallucination surface area
- ป้องกันการ misuse (เช่น ใช้ bot เขียน essay, ถามเรื่องส่วนตัว)

### ทำไมตอบสั้น ไม่มี citation:
- ไม่มีข้อมูลจาก KB เลย → citation block ไม่มีความหมาย
- ตอบสั้นเพื่อ redirect ผู้ใช้กลับมาที่ scope อย่างรวดเร็ว
- ไม่อธิบายยาวว่า "ทำไมตอบไม่ได้" — เสียเวลาช่าง

---

## Cross-cutting Design Decisions

### ทำไมเขียน prompt เป็น section (§):
- **Modularity** — แก้ไข/update ทีละ section ได้ ไม่ต้องเขียนใหม่ทั้งหมด
- **Priority numbering** (P0, P1, P2, P3) ใน §8 → LLM เข้าใจ hierarchy of constraints
- **Reference** — prompt ส่วนอื่นอ้างถึง section ได้ (เช่น "ตาม §1")

### ทำไมมี Response Construction Algorithm (§7):
- LLM ทำงานดีกว่าเมื่อมี **step-by-step procedure** ที่ชัดเจน
- ป้องกัน LLM ข้าม step (เช่น ลืม check escalation, ลืมใส่ citation)
- ทำหน้าที่เป็น **mental checklist** ให้ LLM

### ทำไมมี Hard Constraints Summary (§8):
- **Redundancy by design** — rules ถูกกล่าวซ้ำในรูปแบบที่แตกต่าง
- LLM ให้น้ำหนักกับ content ท้าย prompt มากกว่า → summary ท้ายสุดเป็น reinforcement
- Priority levels (P0 > P1 > P2 > P3) ช่วยให้ LLM ตัดสินใจเมื่อ rules ขัดกัน
