#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
نظام الإشارة المرورية الذكية التكيفية (Smart Adaptive Traffic Light MVP)
باستخدام نموذج YOLO11n بصيغة NCNN ومكتبة OpenCV.

الميزات الرئيسية:
1. توحيد جميع أصناف المركبات (سيارات، دراجات، حافلات، شاحنات) تحت مسمى واحد: "مركبة" (Vehicle).
2. إدارة ومقارنة حركة المرور بين أكثر من إشارة مرور (إشارة 1 وإشارة 2).
3. خوارزمية التوقيت التكيفي (Adaptive Timing):
   - زيادة وقت الإشارة الخضراء للإشارة الأكثر ازدحاماً لتخفيف الأزمة المرورية.
   - تقليل وقت الإشارة الخضراء عن الوقت الافتراضي للإشارة الخالية أو الأقل ازدحاماً.
4. دعم نمطين للتشغيل:
   - النمط الافتراضي (تقاطع طرق): إشارة 1 للكاميرا المباشرة، وإشارة 2 للشارع المتقاطع (مع إمكانية المحاكاة والتحكم اليدوي).
   - نمط تقسيم المسارات (Dual-Zone): تقسيم الشاشة إلى مسارين/إشارتين مرصودتين بالكاميرا معاً (تبديل بالزر [Z]).
5. واجهة بصرية عصرية (HUD) تتضمن إشارات مرور تفاعلية ثلاثية الألوان وعدادات تنازلية ولوحة مقارنة وتفسير للقرارات الذكية.
"""

import os
import time
import cv2
import numpy as np
from ultralytics import YOLO

# ==========================================
# إعدادات المصدر والنموذج (Configuration)
# ==========================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

USE_CAMERA = False              # اضبط على True لتشغيل الكاميرا المباشرة، أو False لقراءة ملف فيديو
VIDEO_PATH = "traffic.mp4"         # مسار ملف الفيديو المسجل
CAMERA_INDEX = 0                  # رقم منفذ الكاميرا
MODEL_PATH = "yolo11n_ncnn_model"    # مسار مجلد نموذج NCNN
IMGSZ = 416                       # أبعاد صورة الاستدلال (محسن للسرعة على Raspberry Pi و CPU)

# أصناف المركبات المستهدفة حسب COCO - جميعها توحد تحت مسمى "Vehicle"
TARGET_CLASSES = {
    2: "Vehicle",   # سيارة (Car)
    3: "Vehicle",   # دراجة نارية (Motorcycle)
    5: "Vehicle",   # حافلة (Bus)
    7: "Vehicle"    # شاحنة (Truck)
}

# ==========================================
# ثوابت خوارزمية الإشارة الذكية (Traffic Logic)
# ==========================================
DEFAULT_GREEN_TIME = 15.0   # الوقت الافتراضي للإشارة الخضراء (بالثواني)
MIN_GREEN_TIME = 5.0        # الحد الأدنى للوقت (عند خلو الطريق لتفادي هدر الوقت)
MAX_GREEN_TIME = 40.0       # الحد الأقصى للوقت (لتفادي حرمان الاتجاه الآخر)
YELLOW_TIME = 3.0           # مدة الإشارة الصفراء الانتقالية
TIME_PER_VEHICLE = 3.0      # الوقت المخصص لعبور المركبة الواحدة


def resolve_path(path: str) -> str:
    """تحويل المسار النسبي إلى مسار مطلق مرتبط بمجلد السكربت تلقائياً."""
    if os.path.isabs(path):
        return path
    if os.path.exists(path):
        return os.path.abspath(path)
    return os.path.join(BASE_DIR, path)


def load_model(model_path: str):
    """تحميل نموذج YOLO11 بصيغة NCNN للاستدلال السريع."""
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
    """تهيئة مصدر الفيديو (كاميرا حية أو ملف فيديو مسجل)."""
    if use_camera:
        print(f"📹 محاولة الاتصال بالكاميرا برقم الفهرس ({camera_index})...")
        cap = cv2.VideoCapture(camera_index)
        if not cap.isOpened():
            print(f"❌ خطأ: تعذر فتح الكاميرا ({camera_index}).")
            return None
        print("✅ تم الاتصال بالكاميرا بنجاح.")
        return cap
    else:
        target_video = resolve_path(video_path)
        if not os.path.exists(target_video):
            print(f"❌ خطأ: ملف الفيديو غير موجود في المسار: '{target_video}'")
            return None

        print(f"🎞️ فتح ملف الفيديو: '{target_video}'...")
        cap = cv2.VideoCapture(target_video)
        if not cap.isOpened():
            print(f"❌ خطأ: فشل فتح ملف الفيديو '{target_video}'.")
            return None
        print("✅ تم فتح ملف الفيديو بنجاح.")
        return cap


class SmartTrafficController:
    """
    متحكم الإشارة المرورية الذكية التكيفية (Adaptive Traffic Controller).
    يقوم بمقارنة أعداد المركبات بين إشارتين وضبط فترات الإشارة الخضراء ديناميكياً:
    - زيادة الوقت عند الازدحام لتفريغ التقاطع.
    - تقليل الوقت عن الافتراضي عند انخفاض أو انعدام المركبات.
    """

    def __init__(self,
                 default_green: float = DEFAULT_GREEN_TIME,
                 min_green: float = MIN_GREEN_TIME,
                 max_green: float = MAX_GREEN_TIME,
                 yellow_time: float = YELLOW_TIME,
                 per_vehicle: float = TIME_PER_VEHICLE):
        self.default_green = default_green
        self.min_green = min_green
        self.max_green = max_green
        self.yellow_time = yellow_time
        self.per_vehicle = per_vehicle

        # حالة الإشارات: 1 أو 2
        self.active_signal = 1
        self.phase = "GREEN"  # "GREEN" أو "YELLOW"

        # التوقيت الحالي
        self.allocated_duration = default_green
        self.remaining_time = default_green
        self.last_timestamp = time.time()

        # أعداد المركبات المرصودة
        self.sig1_count = 0
        self.sig2_count = 0

        # محاكاة مركبات الإشارة الثانية (في نمط التقاطع الافتراضي)
        self.simulated_sig2_count = 1
        self.auto_sim_timer = 0.0

        # نمط تقسيم الشاشة إلى مسارين/منطقتين (Dual-Zone)
        self.zone_mode = False

        # بيانات التفسير والمقارنة للواجهة
        self.sig1_calc_time = default_green
        self.sig2_calc_time = default_green
        self.decision_title = "Initializing..."
        self.decision_details = ["Starting smart traffic controller..."]

    def calculate_green_time(self, count: int, opposing_count: int) -> float:
        """
        حساب مدة الإشارة الخضراء التكيفية بناءً على كثافة المركبات والمقارنة النسبية.
        - إذا كان الطريق خالياً (0 مركبات): تقليل الوقت إلى الحد الأدنى (أقل من الافتراضي).
        - إذا كان الطريق مزدحماً: زيادة الوقت بنسبة طردية لتفريغ الزحام.
        """
        if count == 0:
            return self.min_green

        # وقت الأساس: الوقت الافتراضي مع اعتبار 2 مركبة كمعدل طبيعي
        base_time = self.default_green + (count - 2) * self.per_vehicle

        # مكافأة مقارنة الازدحام مع الإشارة الأخرى
        difference = count - opposing_count
        bonus = difference * 2.0

        target_time = base_time + bonus
        return float(np.clip(target_time, self.min_green, self.max_green))

    def update_counts(self, sig1_vehicles: int, sig2_vehicles: int):
        """تحديث أعداد المركبات وإعادة حساب أزمنة الإشارات المقترحة والمقارنة."""
        self.sig1_count = sig1_vehicles
        self.sig2_count = sig2_vehicles

        # حساب الزمن المقترح لكل إشارة بناءً على المقارنة
        self.sig1_calc_time = self.calculate_green_time(self.sig1_count, self.sig2_count)
        self.sig2_calc_time = self.calculate_green_time(self.sig2_count, self.sig1_count)

        # صياغة نص المقارنة والقرار الذكي
        diff1 = self.sig1_calc_time - self.default_green
        diff2 = self.sig2_calc_time - self.default_green

        if self.sig1_count > self.sig2_count:
            self.decision_title = "Signal 1 Prioritized (Heavy Traffic)"
            self.decision_details = [
                f"Sig 1 has MORE vehicles ({self.sig1_count} vs {self.sig2_count})",
                f"-> Sig 1 Green EXTENDED: {self.sig1_calc_time:.1f}s (+{diff1:.1f}s)",
                f"-> Sig 2 Green REDUCED:  {self.sig2_calc_time:.1f}s ({diff2:.1f}s)"
            ]
        elif self.sig2_count > self.sig1_count:
            self.decision_title = "Signal 2 Prioritized (Heavy Traffic)"
            self.decision_details = [
                f"Sig 2 has MORE vehicles ({self.sig2_count} vs {self.sig1_count})",
                f"-> Sig 2 Green EXTENDED: {self.sig2_calc_time:.1f}s (+{diff2:.1f}s)",
                f"-> Sig 1 Green REDUCED:  {self.sig1_calc_time:.1f}s ({diff1:.1f}s)"
            ]
        else:
            self.decision_title = "Balanced Traffic Flow"
            self.decision_details = [
                f"Both signals have equal load ({self.sig1_count} vehicles)",
                f"-> Applying standard timing: {self.default_green:.1f}s",
                "-> Optimal round-robin dispatch"
            ]

    def step(self, current_time: float):
        """تحديث المؤقتات وحالات الإشارات (أخضر -> أصفر -> أحمر -> الإشارة التالية)."""
        dt = current_time - self.last_timestamp
        self.last_timestamp = current_time

        # محاكاة ديناميكية خفيفة لمركبات الإشارة 2 في حال عدم تفعيل نمط المناطق
        if not self.zone_mode:
            self.auto_sim_timer += dt
            if self.auto_sim_timer >= 12.0:
                self.auto_sim_timer = 0.0
                # تقلب واقعي في أعداد مركبات الشارع المتقاطع بين 0 و 4
                self.simulated_sig2_count = int(np.random.choice([0, 1, 2, 4], p=[0.25, 0.35, 0.25, 0.15]))

        self.remaining_time -= dt

        # التحقق من انتهاء المرحلة الحالية
        if self.remaining_time <= 0:
            if self.phase == "GREEN":
                # الانتقال من الأخضر إلى الأصفر
                self.phase = "YELLOW"
                self.allocated_duration = self.yellow_time
                self.remaining_time = self.yellow_time
            elif self.phase == "YELLOW":
                # الانتقال إلى الإشارة التالية وضبط وقتها الأخضر التكيفي
                self.phase = "GREEN"
                self.active_signal = 2 if self.active_signal == 1 else 1

                # تخصيص الوقت المحسوب تكيفياً للإشارة الجديدة
                if self.active_signal == 1:
                    new_duration = self.sig1_calc_time
                else:
                    new_duration = self.sig2_calc_time

                self.allocated_duration = new_duration
                self.remaining_time = new_duration

    def get_signal_states(self):
        """إرجاع الحالة الضوئية لكل إشارة (GREEN, YELLOW, RED)."""
        if self.active_signal == 1:
            return self.phase, "RED"
        else:
            return "RED", self.phase

    def adjust_simulated_sig2(self, delta: int):
        """تعديل عدد مركبات الإشارة الثانية يدوياً لاختبار سيناريوهات مختلفة."""
        self.simulated_sig2_count = max(0, min(15, self.simulated_sig2_count + delta))

    def toggle_zone_mode(self):
        """التبديل بين نمط التقاطع ومحاكاة الشارع ونمط تقسيم الكاميرا إلى مسارين."""
        self.zone_mode = not self.zone_mode

    def reset_cycle(self):
        """إعادة تعيين دورة الإشارات للبدء من جديد."""
        self.active_signal = 1
        self.phase = "GREEN"
        self.allocated_duration = self.sig1_calc_time
        self.remaining_time = self.allocated_duration
        self.last_timestamp = time.time()


def process_frame(frame, model, target_classes: dict, zone_mode: bool, split_x: int):
    """
    معالجة الإطار:
    - الكشف والتتبع باستخدام YOLO11 NCNN.
    - توحيد جميع الأصناف (سيارة، شاحنة، حافلة، دراجة) تحت مسمى "Vehicle".
    - حساب إجمالي المركبات وتوزيعها حسب المناطق أو المسارات.
    - رسم صناديق أنيقة بمسمى موحد "Vehicle".
    """
    classes_to_detect = list(target_classes.keys())
    results = model.track(
        frame,
        persist=True,
        imgsz=IMGSZ,
        verbose=False,
        classes=classes_to_detect
    )

    annotated = frame.copy()
    boxes = results[0].boxes

    detected_vehicles = []
    zone1_count = 0
    zone2_count = 0

    if boxes is not None and len(boxes) > 0 and boxes.cls is not None:
        cls_list = boxes.cls.int().tolist()
        xyxy_list = boxes.xyxy.cpu().numpy().astype(int)
        id_list = boxes.id.int().tolist() if boxes.id is not None else [None] * len(cls_list)
        conf_list = boxes.conf.cpu().numpy().tolist() if boxes.conf is not None else [1.0] * len(cls_list)

        for i, cls_id in enumerate(cls_list):
            if cls_id in target_classes:
                x1, y1, x2, y2 = xyxy_list[i]
                track_id = id_list[i]
                conf = conf_list[i]
                center_x = (x1 + x2) // 2

                # تحديد المنطقة
                is_zone_1 = (center_x < split_x) if zone_mode else True
                if is_zone_1:
                    zone1_count += 1
                else:
                    zone2_count += 1

                # مسمى موحد لجميع الأصناف دون تمييز نوع السيارة
                label = f"Vehicle #{track_id}" if track_id is not None else f"Vehicle {int(conf * 100)}%"
                color = (0, 240, 140) if is_zone_1 else (0, 180, 255)

                detected_vehicles.append({
                    "box": (x1, y1, x2, y2),
                    "label": label,
                    "color": color,
                    "zone": 1 if is_zone_1 else 2
                })

                # رسم الصندوق المحدد للمركبة
                cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

                # زوايا جمالية لإضفاء طابع تقني حديث
                corner_len = min(15, (x2 - x1) // 4, (y2 - y1) // 4)
                cv2.line(annotated, (x1, y1), (x1 + corner_len, y1), (255, 255, 255), 2)
                cv2.line(annotated, (x1, y1), (x1, y1 + corner_len), (255, 255, 255), 2)
                cv2.line(annotated, (x2, y2), (x2 - corner_len, y2), (255, 255, 255), 2)
                cv2.line(annotated, (x2, y2), (x2, y2 - corner_len), (255, 255, 255), 2)

                # ملصق المسمى الموحد (Vehicle)
                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                tag_y1 = max(0, y1 - th - 6)
                cv2.rectangle(annotated, (x1, tag_y1), (x1 + tw + 8, y1), color, -1)
                cv2.putText(annotated, label, (x1 + 4, y1 - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (10, 15, 20), 1, cv2.LINE_AA)

    total_vehicles = len(detected_vehicles)
    return annotated, total_vehicles, zone1_count, zone2_count


def draw_traffic_light_graphic(canvas, x: int, y: int, state: str):
    """
    رسم مجسم إشارة المرور ثلاثية الألوان (أحمر، أصفر، أخضر)
    مع إضاءة متوهجة للحالة النشطة الحالية.
    """
    w, h = 38, 108
    # هيكل الإشارة الخارجي
    cv2.rectangle(canvas, (x, y), (x + w, y + h), (20, 20, 24), -1)
    cv2.rectangle(canvas, (x, y), (x + w, y + h), (90, 95, 105), 1)

    r = 11
    cx = x + w // 2

    # ضوء أحمر
    cy_red = y + 20
    is_red = (state == "RED")
    red_color = (0, 0, 255) if is_red else (25, 25, 60)
    cv2.circle(canvas, (cx, cy_red), r, red_color, -1)
    if is_red:
        cv2.circle(canvas, (cx, cy_red), r + 3, (50, 80, 255), 1, cv2.LINE_AA)

    # ضوء أصفر
    cy_yel = y + 54
    is_yel = (state == "YELLOW")
    yel_color = (0, 230, 255) if is_yel else (25, 50, 50)
    cv2.circle(canvas, (cx, cy_yel), r, yel_color, -1)
    if is_yel:
        cv2.circle(canvas, (cx, cy_yel), r + 3, (0, 255, 255), 1, cv2.LINE_AA)

    # ضوء أخضر
    cy_grn = y + 88
    is_grn = (state == "GREEN")
    grn_color = (0, 255, 0) if is_grn else (25, 60, 25)
    cv2.circle(canvas, (cx, cy_grn), r, grn_color, -1)
    if is_grn:
        cv2.circle(canvas, (cx, cy_grn), r + 3, (120, 255, 120), 1, cv2.LINE_AA)


def draw_hud(frame, controller: SmartTrafficController, fps: float, split_x: int, is_paused: bool = False):
    """
    رسم لوحة التحكم الذكية العصرية (Smart Traffic HUD):
    - إشارات المرور الرسومية لكل مسار/اتجاه.
    - العداد التنازلي الزمني وشريط التقدم.
    - مقارنة أعداد المركبات الإجمالية والقرارات الذكية للتوقيت.
    - مؤشرات الحالة والمفاتيح التفاعلية.
    """
    h_frame, w_frame = frame.shape[:2]

    # رسم خط تقسيم المسارات في حال تفعيل نمط المناطق (Dual-Zone)
    if controller.zone_mode:
        cv2.line(frame, (split_x, 70), (split_x, h_frame - 20), (0, 200, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, "<< ZONE 1 (Signal 1)", (split_x - 190, 85),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 240, 140), 1, cv2.LINE_AA)
        cv2.putText(frame, "ZONE 2 (Signal 2) >>", (split_x + 15, 85),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 180, 255), 1, cv2.LINE_AA)

    # إنشاء لوحة جانبية شبه شفافة على اليسار لعرض بيانات التحكم بوضوح
    panel_w = 425
    panel_h = h_frame - 30
    overlay = frame.copy()
    cv2.rectangle(overlay, (15, 15), (15 + panel_w, 15 + panel_h), (16, 20, 26), -1)
    alpha = 0.82
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
    cv2.rectangle(frame, (15, 15), (15 + panel_w, 15 + panel_h), (0, 175, 215), 1)

    # 1. ترويسة النظام (System Header)
    cv2.putText(frame, "SMART TRAFFIC CONTROLLER", (28, 44),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
    mode_str = "Mode: Dual-Zone Split" if controller.zone_mode else "Mode: Intersection Feed + Sim"
    cv2.putText(frame, f"Adaptive Signal Timing MVP  |  {mode_str}", (28, 65),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 210, 255), 1, cv2.LINE_AA)
    cv2.line(frame, (28, 73), (425, 73), (45, 55, 70), 1)

    sig1_state, sig2_state = controller.get_signal_states()

    # 2. بطاقة الإشارة 1 (Signal 1 Card)
    c1_y = 82
    c1_h = 135
    is_s1_active = (controller.active_signal == 1)
    border_s1 = (0, 220, 120) if is_s1_active else (40, 48, 60)
    cv2.rectangle(frame, (25, c1_y), (425, c1_y + c1_h), (22, 28, 38), -1)
    cv2.rectangle(frame, (25, c1_y), (425, c1_y + c1_h), border_s1, 1)

    draw_traffic_light_graphic(frame, 35, c1_y + 13, sig1_state)

    state_col_s1 = (0, 255, 0) if sig1_state == "GREEN" else ((0, 230, 255) if sig1_state == "YELLOW" else (0, 0, 255))
    s1_title = "SIGNAL 1 [Main Road / Camera]" if not controller.zone_mode else "SIGNAL 1 [Zone 1 - Left]"
    cv2.putText(frame, s1_title, (85, c1_y + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(frame, f"State: [{sig1_state}]", (85, c1_y + 44), cv2.FONT_HERSHEY_SIMPLEX, 0.48, state_col_s1, 1, cv2.LINE_AA)
    cv2.putText(frame, f"Total Vehicles: {controller.sig1_count}", (85, c1_y + 66), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (230, 230, 230), 1, cv2.LINE_AA)

    diff1 = controller.sig1_calc_time - controller.default_green
    diff_sign1 = f"+{diff1:.1f}s" if diff1 > 0 else f"{diff1:.1f}s"
    diff_col1 = (0, 255, 120) if diff1 > 0 else ((0, 165, 255) if diff1 < 0 else (200, 200, 200))
    cv2.putText(frame, f"Allocated Green: {controller.sig1_calc_time:.1f}s ({diff_sign1})",
                (85, c1_y + 88), cv2.FONT_HERSHEY_SIMPLEX, 0.44, diff_col1, 1, cv2.LINE_AA)

    if is_s1_active:
        rem = max(0.0, controller.remaining_time)
        dur = max(0.1, controller.allocated_duration)
        ratio = min(1.0, rem / dur)
        cv2.putText(frame, f"Countdown: {rem:.1f}s", (85, c1_y + 110), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 255, 255), 1, cv2.LINE_AA)
        # شريط التقدم الزمني
        cv2.rectangle(frame, (230, c1_y + 102), (410, c1_y + 112), (30, 35, 45), -1)
        fill_w = int(180 * ratio)
        cv2.rectangle(frame, (230, c1_y + 102), (230 + fill_w, c1_y + 112), state_col_s1, -1)
    else:
        cv2.putText(frame, "Waiting for signal turn...", (85, c1_y + 110),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (130, 135, 145), 1, cv2.LINE_AA)

    # 3. بطاقة الإشارة 2 (Signal 2 Card)
    c2_y = 227
    c2_h = 135
    is_s2_active = (controller.active_signal == 2)
    border_s2 = (0, 220, 120) if is_s2_active else (40, 48, 60)
    cv2.rectangle(frame, (25, c2_y), (425, c2_y + c2_h), (22, 28, 38), -1)
    cv2.rectangle(frame, (25, c2_y), (425, c2_y + c2_h), border_s2, 1)

    draw_traffic_light_graphic(frame, 35, c2_y + 13, sig2_state)

    state_col_s2 = (0, 255, 0) if sig2_state == "GREEN" else ((0, 230, 255) if sig2_state == "YELLOW" else (0, 0, 255))
    s2_title = "SIGNAL 2 [Cross Road / Sim]" if not controller.zone_mode else "SIGNAL 2 [Zone 2 - Right]"
    cv2.putText(frame, s2_title, (85, c2_y + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(frame, f"State: [{sig2_state}]", (85, c2_y + 44), cv2.FONT_HERSHEY_SIMPLEX, 0.48, state_col_s2, 1, cv2.LINE_AA)
    cv2.putText(frame, f"Total Vehicles: {controller.sig2_count}", (85, c2_y + 66), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (230, 230, 230), 1, cv2.LINE_AA)

    diff2 = controller.sig2_calc_time - controller.default_green
    diff_sign2 = f"+{diff2:.1f}s" if diff2 > 0 else f"{diff2:.1f}s"
    diff_col2 = (0, 255, 120) if diff2 > 0 else ((0, 165, 255) if diff2 < 0 else (200, 200, 200))
    cv2.putText(frame, f"Allocated Green: {controller.sig2_calc_time:.1f}s ({diff_sign2})",
                (85, c2_y + 88), cv2.FONT_HERSHEY_SIMPLEX, 0.44, diff_col2, 1, cv2.LINE_AA)

    if is_s2_active:
        rem = max(0.0, controller.remaining_time)
        dur = max(0.1, controller.allocated_duration)
        ratio = min(1.0, rem / dur)
        cv2.putText(frame, f"Countdown: {rem:.1f}s", (85, c2_y + 110), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 255, 255), 1, cv2.LINE_AA)
        cv2.rectangle(frame, (230, c2_y + 102), (410, c2_y + 112), (30, 35, 45), -1)
        fill_w = int(180 * ratio)
        cv2.rectangle(frame, (230, c2_y + 102), (230 + fill_w, c2_y + 112), state_col_s2, -1)
    else:
        cv2.putText(frame, "Waiting for signal turn...", (85, c2_y + 110),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (130, 135, 145), 1, cv2.LINE_AA)

    # 4. بطاقة مقارنة وقرار الذكاء الاصطناعي (AI Decision & Comparison Card)
    c3_y = 372
    c3_h = 175
    cv2.rectangle(frame, (25, c3_y), (425, c3_y + c3_h), (20, 25, 34), -1)
    cv2.rectangle(frame, (25, c3_y), (425, c3_y + c3_h), (0, 140, 220), 1)

    cv2.putText(frame, "AI ADAPTIVE TIMING DECISION", (35, c3_y + 24),
                cv2.FONT_HERSHEY_SIMPLEX, 0.50, (0, 220, 255), 1, cv2.LINE_AA)
    cv2.line(frame, (35, c3_y + 32), (415, c3_y + 32), (35, 45, 60), 1)

    cv2.putText(frame, f">> {controller.decision_title}", (35, c3_y + 54),
                cv2.FONT_HERSHEY_SIMPLEX, 0.46, (255, 255, 255), 1, cv2.LINE_AA)

    line_y = c3_y + 78
    for line in controller.decision_details:
        cv2.putText(frame, line, (42, line_y), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (190, 200, 215), 1, cv2.LINE_AA)
        line_y += 22

    # مقياس الكفاءة
    saved_time = max(0.0, controller.default_green - min(controller.sig1_calc_time, controller.sig2_calc_time))
    cv2.putText(frame, f"Wait Time Saved: {saved_time:.1f}s by cutting idle green",
                (35, c3_y + 158), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 180), 1, cv2.LINE_AA)

    # 5. لوحة التحكم السريع وإرشادات المفاتيح (Quick Controls Footer)
    c4_y = 557
    c4_h = panel_h - (c4_y - 15) - 10
    cv2.rectangle(frame, (25, c4_y), (425, c4_y + c4_h), (18, 22, 30), -1)
    cv2.rectangle(frame, (25, c4_y), (425, c4_y + c4_h), (35, 45, 60), 1)

    cv2.putText(frame, "CONTROLS & SHORTCUTS", (35, c4_y + 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.44, (160, 175, 195), 1, cv2.LINE_AA)
    cv2.putText(frame, "[Space] Pause/Resume    | [Q] Quit", (35, c4_y + 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (210, 210, 210), 1, cv2.LINE_AA)
    cv2.putText(frame, "[+] / [-] Adjust Sig 2 Vehicles (Sim Mode)", (35, c4_y + 60),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 200, 255), 1, cv2.LINE_AA)
    cv2.putText(frame, f"[Z] Toggle Dual-Zone Mode (Current: {'ON' if controller.zone_mode else 'OFF'})",
                (35, c4_y + 80), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 255, 150), 1, cv2.LINE_AA)
    cv2.putText(frame, "[R] Reset Signal Cycle", (35, c4_y + 100),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 200, 200), 1, cv2.LINE_AA)

    # 6. شارة FPS وإجمالي المركبات في أعلى اليمين
    total_screen_vehicles = controller.sig1_count + (controller.sig2_count if controller.zone_mode else 0)
    badge_w = 260
    badge_x = w_frame - badge_w - 20
    cv2.rectangle(frame, (badge_x, 15), (badge_x + badge_w, 55), (16, 20, 26), -1)
    cv2.rectangle(frame, (badge_x, 15), (badge_x + badge_w, 55), (0, 175, 215), 1)
    fps_color = (0, 255, 0) if fps >= 15 else (0, 165, 255)
    cv2.putText(frame, f"FPS: {fps:.1f}", (badge_x + 15, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, fps_color, 2, cv2.LINE_AA)
    cv2.putText(frame, f"Vehicles: {total_screen_vehicles}", (badge_x + 120, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)

    # تنبيه الإيقاف المؤقت
    if is_paused:
        badge_text = "PAUSED"
        text_size = cv2.getTextSize(badge_text, cv2.FONT_HERSHEY_SIMPLEX, 1.3, 3)[0]
        text_x = (w_frame - text_size[0]) // 2
        cv2.rectangle(frame, (text_x - 20, 30), (text_x + text_size[0] + 20, 85), (0, 0, 160), -1)
        cv2.putText(frame, badge_text, (text_x, 70),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.3, (255, 255, 255), 3, cv2.LINE_AA)


def main():
    """الدالة الرئيسية لإدارة التدفق: معالجة الإطارات، تشغيل نموذج YOLO، وحسابات الإشارة الذكية."""
    print("=" * 60)
    print("🚦 نظام الإشارة المرورية الذكية التكيفية (Smart Traffic Light MVP)")
    print("=" * 60)

    # 1. تحميل النموذج
    model = load_model(MODEL_PATH)
    if model is None:
        return

    # 2. تهيئة مصدر الفيديو
    cap = get_video_source(USE_CAMERA, CAMERA_INDEX, VIDEO_PATH)
    if cap is None:
        return

    # استخراج أبعاد الفيديو
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    split_x = frame_width // 2 if frame_width > 0 else 640

    # 3. تهيئة متحكم الإشارة الذكية
    controller = SmartTrafficController(
        default_green=DEFAULT_GREEN_TIME,
        min_green=MIN_GREEN_TIME,
        max_green=MAX_GREEN_TIME,
        yellow_time=YELLOW_TIME,
        per_vehicle=TIME_PER_VEHICLE
    )

    window_name = "Smart Adaptive Traffic Light System (MVP)"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    print("\n🚀 انطلق النظام بنجاح!")
    print("💡 ميزات النظام:")
    print("   - جميع المركبات مجمعة تحت مسمى واحد 'Vehicle' (مجموع المركبات).")
    print(f"   - وقت الإشارة الخضراء الافتراضي: {DEFAULT_GREEN_TIME} ثانية.")
    print(f"   - الحد الأدنى عند خلو الطريق: {MIN_GREEN_TIME} ثوانٍ (تقليل الوقت).")
    print(f"   - الحد الأقصى عند الازدحام: {MAX_GREEN_TIME} ثانية (تمديد الوقت لتخفيف الأزمة).")
    print("⌨️  لوحة المفاتيح:")
    print("   - [Space]: إيقاف مؤقت / استئناف الفيديو.")
    print("   - [+] / [-]: زيادة / تقليل عدد مركبات الإشارة 2 في المحاكاة لاختبار التفاعل.")
    print("   - [Z]: التبديل بين نمط تقاطع الطرق ونمط تقسيم الكاميرا لمسارين (Dual-Zone).")
    print("   - [R]: إعادة تعيين دورة الإشارات.")
    print("   - [Q]: إنهاء البرنامج.\n")

    prev_time = time.time()
    fps = 0.0
    is_paused = False
    last_display_frame = None

    try:
        while True:
            current_time = time.time()

            if not is_paused:
                ret, frame = cap.read()
                # إذا وصلنا لنهاية الفيديو، نعيد تشغيله بشكل دائري لاستمرار المحاكاة
                if not ret:
                    if not USE_CAMERA:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        ret, frame = cap.read()
                    if not ret:
                        print("\nℹ️ تم الوصول إلى نهاية الفيديو أو تعذر استقبال الإطارات.")
                        break

                # حساب معدل الإطارات (FPS)
                dt = current_time - prev_time
                if dt > 0:
                    current_fps = 1.0 / dt
                    fps = 0.9 * fps + 0.1 * current_fps if fps > 0 else current_fps
                prev_time = current_time

                # 4. معالجة الإطار ورصد وتتبع المركبات بمسمى موحد
                annotated_frame, total_detected, zone1_count, zone2_count = process_frame(
                    frame, model, TARGET_CLASSES, controller.zone_mode, split_x
                )

                # 5. تحديث أعداد الإشارات بناءً على نمط التشغيل
                if controller.zone_mode:
                    sig1_v = zone1_count
                    sig2_v = zone2_count
                else:
                    sig1_v = total_detected
                    sig2_v = controller.simulated_sig2_count

                controller.update_counts(sig1_v, sig2_v)
                controller.step(current_time)

                # 6. رسم واجهة العرض التفاعلية (HUD)
                display_frame = annotated_frame.copy()
                draw_hud(display_frame, controller, fps, split_x, is_paused=False)
                last_display_frame = display_frame
                cv2.imshow(window_name, display_frame)

            # معالجة مدخلات لوحة المفاتيح
            wait_delay = 30 if is_paused else 1
            key = cv2.waitKey(wait_delay) & 0xFF

            if key in (ord('q'), ord('Q')):
                print("\n🛑 تم إنهاء البرنامج بناءً على طلب المستخدم.")
                break
            elif key == ord(' '):
                is_paused = not is_paused
                prev_time = time.time()
                controller.last_timestamp = time.time()
                if is_paused and last_display_frame is not None:
                    paused_display = last_display_frame.copy()
                    draw_hud(paused_display, controller, fps, split_x, is_paused=True)
                    cv2.imshow(window_name, paused_display)
                print("⏸️ تم الإيقاف المؤقت." if is_paused else "▶️ تم استئناف الفيديو.")
            elif key in (ord('+'), ord('=')):
                controller.adjust_simulated_sig2(+1)
                print(f"🔼 زيادة مركبات الإشارة 2 في المحاكاة إلى: {controller.simulated_sig2_count}")
            elif key in (ord('-'), ord('_')):
                controller.adjust_simulated_sig2(-1)
                print(f"🔽 تقليل مركبات الإشارة 2 في المحاكاة إلى: {controller.simulated_sig2_count}")
            elif key in (ord('z'), ord('Z')):
                controller.toggle_zone_mode()
                mode_name = "تقسيم الكاميرا لمسارين (Dual-Zone)" if controller.zone_mode else "تقاطع طرق ومحاكاة (Intersection)"
                print(f"🔄 تم تغيير نمط التشغيل إلى: {mode_name}")
            elif key in (ord('r'), ord('R')):
                controller.reset_cycle()
                print("🔄 تم إعادة ضبط دورة الإشارات.")

    except KeyboardInterrupt:
        print("\n⚠️ تم إيقاف البرنامج يدوياً (Ctrl+C).")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("🧹 تم تحرير الكاميرا وإغلاق جميع النوافذ بنجاح.")


if __name__ == "__main__":
    main()
