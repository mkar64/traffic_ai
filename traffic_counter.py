#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
برنامج عدّ وتتبع المركبات الذكي (Traffic Vehicle Counter)
باستخدام نموذج YOLO11n المُصدّر بصيغة NCNN ومكتبة OpenCV.
متوافق مع معالجات ARM وأجهزة Raspberry Pi 4.
"""

import os
import time
import cv2
from ultralytics import YOLO
 
# ==========================================
# إعدادات المصدر والنموذج (Configuration)
# ==========================================
# تحديد مسار مجلد السكربت لضمان عمل الكود من أي مكان في الطرفية
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

USE_CAMERA = False            # اضبط على True لتشغيل الكاميرا، أو False لقراءة ملف فيديو
VIDEO_PATH = "traffic.mp4"       # مسار ملف الفيديو في حال كان USE_CAMERA = False
CAMERA_INDEX = 0                # رقم منفذ الكاميرا (0 غالباً للكاميرا المدمجة أو الأولى)
MODEL_PATH = "yolo11n_ncnn_model"  # مسار مجلد نموذج NCNN (نسبي لمجلد السكربت أو مسار كامل)
IMGSZ = 416                     # أبعاد الصورة للاستدلال السريع المناسب لأجهزة الرام والقدرات المحدودة

# أصناف المركبات المستهدفة حسب تصنيف COCO القياسي
TARGET_CLASSES = {
    2: "Car",          # سيارة
    3: "Motorcycle",   # دراجة نارية
    5: "Bus",          # حافلة
    7: "Truck"         # شاحنة
}


def resolve_path(path: str) -> str:
    """
    تحويل المسار النسبي إلى مسار مطلق مرتبط بمجلد السكربت تلقائياً
    لتفادي أخطاء التشغيل عند استدعاء البرنامج من مسارات أخرى.
    """
    if os.path.isabs(path):
        return path
    if os.path.exists(path):
        return os.path.abspath(path)
    return os.path.join(BASE_DIR, path)


def load_model(model_path: str):
    """
    تحميل نموذج YOLO11 بصيغة NCNN للاستدلال السريع.
    """
    target_path = resolve_path(model_path)
    if not os.path.exists(target_path):
        print(f"❌ خطأ: لم يتم العثور على مجلد النموذج في المسار: '{target_path}'")
        return None
    try:
        print(f"🔄 جاري تحميل نموذج NCNN من المسار: {target_path}...")
        model = YOLO(target_path, task="detect")
        print("✅ تم تحميل النموذج بنجاح.")
        return model
    except Exception as e:
        print(f"❌ فشل تحميل النموذج: {e}")
        return None


def get_video_source(use_camera: bool, camera_index: int, video_path: str):
    """
    تهيئة والتحقق من مصدر الفيديو (كاميرا حية أو ملف فيديو مسجل)
    مع إظهار رسائل خطأ واضحة ومفصلة في حال التعذر.
    """
    if use_camera:
        print(f"📹 محاولة الاتصال بالكاميرا برقم الفهرس ({camera_index})...")
        cap = cv2.VideoCapture(camera_index)
        if not cap.isOpened():
            print(f"❌ خطأ: تعذر فتح الكاميرا ({camera_index}).")
            print("💡 يرجى التأكد من توصيل الكاميرا وصلاحيات الوصول، أو تجربة رقم كاميرا آخر.")
            return None
        print("✅ تم الاتصال بالكاميرا بنجاح.")
        return cap
    else:
        target_video = resolve_path(video_path)
        if not os.path.exists(target_video):
            print(f"❌ خطأ: ملف الفيديو غير موجود في المسار: '{target_video}'")
            print("💡 يرجى التأكد من وجود الملف أو تعديل متغير VIDEO_PATH.")
            return None

        print(f"🎞️ فتح ملف الفيديو: '{target_video}'...")
        cap = cv2.VideoCapture(target_video)
        if not cap.isOpened():
            print(f"❌ خطأ: فشل فتح ملف الفيديو '{target_video}'. قد يكون الملف تالفاً أو بتنسيق غير مدعوم.")
            return None
        print("✅ تم فتح ملف الفيديو بنجاح.")
        return cap


def process_frame(frame, model, target_classes: dict):
    """
    معالجة الإطار الحالي:
    - تنفيذ التتبع (Tracking) باستخدام نموذج NCNN.
    - فلترة الأصناف المستهدفة (المركبات فقط).
    - عدّ المركبات الإجمالية وتفصيل كل صنف.
    - رسم صناديق التتبع التلقائية.
    """
    classes_to_detect = list(target_classes.keys())

    # تشغيل نموذج التعقب مع تفعيل persist للحفاظ على معرّفات التتبع
    results = model.track(
        frame,
        persist=True,
        imgsz=IMGSZ,
        verbose=False,
        classes=classes_to_detect
    )

    # رسم صناديق التحديد ومعرفات التتبع المولدة تلقائياً
    annotated_frame = results[0].plot()

    # تهيئة عداد لكل صنف مستهدف
    counts = {cls_id: 0 for cls_id in classes_to_detect}

    # قراءة وتصنيف الصناديق المكتشفة في الإطار
    boxes = results[0].boxes
    if boxes is not None and len(boxes) > 0 and boxes.cls is not None:
        detected_classes = boxes.cls.int().tolist()
        for cls_id in detected_classes:
            if cls_id in counts:
                counts[cls_id] += 1

    total_vehicles = sum(counts.values())

    return annotated_frame, total_vehicles, counts


def draw_hud(frame, fps: float, total_count: int, counts: dict, is_paused: bool = False):
    """
    رسم واجهة عرض شفافة ومنظمة (HUD) لعرض:
    - سرعة المعالجة الفعلية (FPS).
    - العدد الإجمالي للمركبات في الإطار الحالي.
    - تفصيل أعداد كل نوع (سيارات، شاحنات، حافلات، دراجات).
    - إشارات التوقف والتحكم.
    """
    # رسم مستطيل خلفية شبه شفاف لعرض المعلومات بوضوح تام
    overlay = frame.copy()
    cv2.rectangle(overlay, (15, 15), (350, 165), (20, 20, 20), -1)
    alpha = 0.65
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)

    # إطار جمالي للمربع
    cv2.rectangle(frame, (15, 15), (350, 165), (0, 200, 255), 1)

    # عرض سرعة المعالجة (FPS) بلون ديناميكي
    fps_color = (0, 255, 0) if fps >= 15 else (0, 165, 255)
    cv2.putText(frame, f"FPS: {fps:.1f}", (25, 42),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, fps_color, 2)

    # عرض العدد الإجمالي للمركبات الحالية
    cv2.putText(frame, f"Current Vehicles: {total_count}", (25, 75),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

    # تفصيل أعداد المركبات بحسب النوع
    breakdown_1 = f"Cars: {counts.get(2, 0)}  |  Trucks: {counts.get(7, 0)}"
    breakdown_2 = f"Buses: {counts.get(5, 0)} |  Moto: {counts.get(3, 0)}"
    cv2.putText(frame, breakdown_1, (25, 105),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (210, 210, 210), 1)
    cv2.putText(frame, breakdown_2, (25, 130),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (210, 210, 210), 1)

    # إرشادات لوحة المفاتيح
    cv2.putText(frame, "[Space]: Pause/Resume  |  [Q]: Quit", (25, 153),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (160, 160, 160), 1)

    # تنبيه مرئي عند إيقاف العرض مؤقتاً
    if is_paused:
        height, width = frame.shape[:2]
        badge_text = "PAUSED"
        text_size = cv2.getTextSize(badge_text, cv2.FONT_HERSHEY_SIMPLEX, 1.2, 3)[0]
        text_x = (width - text_size[0]) // 2
        cv2.putText(frame, badge_text, (text_x, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)


def main():
    """
    الدالة الرئيسية لإدارة التدفق: قراءة الإطارات، الحسابات، التفاعل مع المستخدم، والتنظيف.
    """
    # 1. تحميل النموذج
    model = load_model(MODEL_PATH)
    if model is None:
        return

    # 2. تهيئة مصدر الفيديو
    cap = get_video_source(USE_CAMERA, CAMERA_INDEX, VIDEO_PATH)
    if cap is None:
        return

    window_name = "YOLO11 NCNN Traffic Counter"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    print("\n🚀 انطلق البرنامج!")
    print("⌨️  اضغط على [Space] للإيقاف المؤقت / الاستئناف.")
    print("⌨️  اضغط على [Q] للخروج وإنهاء البرنامج.\n")

    prev_time = time.time()
    fps = 0.0
    is_paused = False
    last_annotated_frame = None
    last_total_count = 0
    last_counts = {k: 0 for k in TARGET_CLASSES}

    try:
        while True:
            # في حالة عدم الإيقاف المؤقت، نقرأ إطاراً جديداً ونعالجه
            if not is_paused:
                ret, frame = cap.read()
                if not ret:
                    print("\nℹ️ تم الوصول إلى نهاية الفيديو أو تعذر استقبال الإطارات.")
                    break

                # حساب سرعة المعالجة (FPS)
                current_time = time.time()
                time_diff = current_time - prev_time
                if time_diff > 0:
                    current_fps = 1.0 / time_diff
                    fps = 0.9 * fps + 0.1 * current_fps if fps > 0 else current_fps
                prev_time = current_time

                # معالجة الإطار واستخراج البيانات
                annotated_frame, total_count, counts = process_frame(
                    frame, model, TARGET_CLASSES
                )

                last_annotated_frame = annotated_frame
                last_total_count = total_count
                last_counts = counts

                # تجهيز الإطار النهائي مع واجهة العرض البيانية (HUD)
                display_frame = annotated_frame.copy()
                draw_hud(display_frame, fps, total_count, counts, is_paused=False)
                cv2.imshow(window_name, display_frame)

            # معالجة مدخلات لوحة المفاتيح
            # إذا كان متوقفاً ننتظر وقتاً أطول لتوفير طاقة المعالج (30ms)، وإلا 1ms لأقصى سلاسة
            wait_delay = 30 if is_paused else 1
            key = cv2.waitKey(wait_delay) & 0xFF

            if key in (ord('q'), ord('Q')):
                print("\n🛑 تم إنهاء البرنامج بناءً على طلب المستخدم.")
                break
            elif key == ord(' '):
                is_paused = not is_paused
                prev_time = time.time()  # إعادة ضبط المؤقت لمنع تشوه حساب الـ FPS بعد الاستئناف
                if is_paused and last_annotated_frame is not None:
                    # تحديث الشاشة لإظهار شارة PAUSED مع الاحتفاظ بآخر إحصائيات
                    paused_display = last_annotated_frame.copy()
                    draw_hud(paused_display, fps, last_total_count, last_counts, is_paused=True)
                    cv2.imshow(window_name, paused_display)
                print("⏸️ تم الإيقاف المؤقت." if is_paused else "▶️ تم استئناف الفيديو.")

    except KeyboardInterrupt:
        print("\n⚠️ تم إيقاف البرنامج يدوياً (Ctrl+C).")
    finally:
        # 3. الخروج النظيف وتحرير الموارد
        cap.release()
        cv2.destroyAllWindows()
        print("🧹 تم تحرير الكاميرا وإغلاق جميع النوافذ بنجاح.")


if __name__ == "__main__":
    main()
