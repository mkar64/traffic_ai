# Smart Traffic Vehicle Counter (YOLO11 NCNN)

نظام ذكي لعدّ وتتبع المركبات في الوقت الفعلي باستخدام نموذج **YOLO11n** المُصدّر بصيغة **NCNN** ومكتبة **OpenCV**، ومُحسّن للعمل بكفاءة وسرعة على الأجهزة ذات الموارد المحدودة مثل **Raspberry Pi 4**.

---

## 🚀 المميزات الرئيسية (Features)

- **استدلال فائق السرعة عبر NCNN**: استخدام نموذج `yolo11n_ncnn_model` مع حجم إدخال `imgsz=416` للحصول على أعلى معدل إطارات (FPS).
- **تتبع متعدد للمركبات (Object Tracking)**: استخدام `model.track()` مع تفعيل `persist=True` لتتبع المركبات المارة بدقة.
- **فلترة أصناف محددة**: التعرف على المركبات فقط وفق معيار COCO:
  - السيارات (`Car - ID: 2`)
  - الدراجات النارية (`Motorcycle - ID: 3`)
  - الحافلات (`Bus - ID: 5`)
  - الشاحنات (`Truck - ID: 7`)
- **واجهة مراقبة بصرية (HUD Overlay)**:
  - عرض معدل الإطارات اللحظي (`FPS`).
  - إجمالي المركبات المتواجدة في الإطار الحالي (`Current Vehicles`).
  - تفصيل لحظي لعدد كل صنف من المركبات.
- **مرونة في مصدر الفيديو**: دعم التبديل السهل بين كاميرا الجهاز (Webcam) وملفات الفيديو المسجلة (`.mp4`).
- **تحكم تفاعلي أثناء التشغيل**:
  - الضغط على <kbd>Space</kbd>: إيقاف مؤقت / استئناف الفيديو.
  - الضغط على <kbd>Q</kbd>: خروج نظيف وتحرير الكاميرا وإغلاق النوافذ.

---

## 📁 هيكلية المشروع (Project Structure)

```text
traffic_ai/
├── traffic_counter.py      # السكربت الرئيسي لمعالجة وتتبع المركبات
├── yolo11n_ncnn_model/     # نموذج YOLO11n المحول لصيغة NCNN
│   ├── model.ncnn.bin
│   ├── model.ncnn.param
│   └── metadata.yaml
├── traffic.mp4             # فيديو تجريبي لحركة المرور
├── requirements.txt        # المتطلبات والمكتبات البرمجية
├── .gitignore              # الملفات المستثناة من التتبع
└── README.md               # دليل التوثيق
```

---

## 🛠️ التثبيت والإعداد (Setup & Installation)

### 1. استنساخ المستودع (Clone)
```bash
git clone <YOUR_REPOSITORY_URL>
cd traffic_ai
```

### 2. إنشاء بيئة عمل افتراضية وتفعيلها
```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. تثبيت المتطلبات (Requirements)
```bash
pip install -r requirements.txt
```

---

## ▶️ التشغيل (Usage)

لتشغيل البرنامج:
```bash
python traffic_counter.py
```

### التبديل بين الكاميرا وملف الفيديو:
يمكنك تعديل المتغيرات في بداية ملف `traffic_counter.py`:
```python
USE_CAMERA = False          # اضبط على True لتشغيل الكاميرا، أو False لملف الفيديو
VIDEO_PATH = "traffic.mp4"   # مسار ملف الفيديو المسجل
CAMERA_INDEX = 0            # رقم تعريف الكاميرا
```
