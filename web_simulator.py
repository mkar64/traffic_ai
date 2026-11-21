#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سيرفر محاكاة الإشارة الذكية التفاعلي للويب (Smart Traffic Light Web Simulator Server)
يربط صفحة الويب بنموذج YOLO11 NCNN لمعالجة صور التقاطع الرباعي وحساب أزمنة الإشارات.
"""

import os
import io
import json
import base64
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
import cv2
import numpy as np
from ultralytics import YOLO

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "smart_city")
MODEL_PATH = os.path.join(BASE_DIR, "yolo11n_ncnn_model")
PORT = 8080

# أصناف المركبات المستهدفة حسب تصنيف COCO
TARGET_CLASSES = [2, 3, 5, 7]  # Car, Motorcycle, Bus, Truck


def load_model():
    """تحميل نموذج YOLO11 NCNN في الذاكرة."""
    if not os.path.exists(MODEL_PATH):
        print(f"❌ لم يتم العثور على مجلد النموذج: {MODEL_PATH}")
        return None
    print(f"🔄 جاري تحميل نموذج NCNN: {MODEL_PATH}...")
    try:
        model = YOLO(MODEL_PATH, task="detect")
        print("✅ تم تحميل نموذج YOLO بنجاح.")
        return model
    except Exception as e:
        print(f"❌ خطأ أثناء تحميل النموذج: {e}")
        return None


# تحميل النموذج عند بدء التشغيل
yolo_model = load_model()


class SimulatorRequestHandler(SimpleHTTPRequestHandler):
    """معالج طلبات السيرفر: يخدم ملفات الويب ويتعامل مع مسارات API الذكية."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        # إضافة ترويسات CORS لمنع مشاكل الأذونات
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/detect":
            self.handle_detect()
        else:
            self.send_error(404, "Endpoint not found")

    def handle_detect(self):
        """معالجة صورة مرفوعة واكتشاف المركبات بنموذج YOLO11."""
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        try:
            req_json = json.loads(post_data.decode("utf-8"))
            img_data = req_json.get("image", "")
            approach = req_json.get("approach", "unknown")

            # استخراج بيانات base64
            if "," in img_data:
                img_data = img_data.split(",")[1]

            img_bytes = base64.b64decode(img_data)
            np_arr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

            if img is None:
                raise ValueError("Failed to decode image")

            # تنفيذ الاستدلال بنموذج YOLO11 NCNN
            count = 0
            boxes_data = []
            annotated_img = img.copy()

            if yolo_model is not None:
                results = yolo_model.predict(
                    img,
                    imgsz=416,
                    verbose=False,
                    classes=TARGET_CLASSES
                )

                boxes = results[0].boxes
                if boxes is not None and len(boxes) > 0:
                    cls_list = boxes.cls.int().tolist()
                    xyxy_list = boxes.xyxy.cpu().numpy().astype(int)
                    conf_list = boxes.conf.cpu().numpy().tolist()

                    for i, cls_id in enumerate(cls_list):
                        if cls_id in TARGET_CLASSES:
                            count += 1
                            x1, y1, x2, y2 = xyxy_list[i]
                            conf = conf_list[i]
                            boxes_data.append({
                                "box": [int(x1), int(y1), int(x2), int(y2)],
                                "confidence": round(float(conf), 2),
                                "label": "Vehicle"
                            })

                            # رسم الصندوق المحدد مع مسمى موحد "Vehicle"
                            color = (0, 240, 140)
                            cv2.rectangle(annotated_img, (x1, y1), (x2, y2), color, 2)
                            label = f"Vehicle {int(conf * 100)}%"
                            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                            cv2.rectangle(annotated_img, (x1, max(0, y1 - th - 6)), (x1 + tw + 8, y1), color, -1)
                            cv2.putText(annotated_img, label, (x1 + 4, y1 - 4),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (10, 15, 20), 1, cv2.LINE_AA)

            # تحويل الصورة المعالجة إلى base64 لإعادتها للمتصفح
            _, buffer = cv2.imencode(".jpg", annotated_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            annotated_b64 = "data:image/jpeg;base64," + base64.b64encode(buffer).decode("utf-8")

            response_data = {
                "status": "success",
                "approach": approach,
                "count": count,
                "boxes": boxes_data,
                "annotated_image": annotated_b64
            }

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response_data).encode("utf-8"))

        except Exception as e:
            print(f"❌ خطأ أثناء معالجة الصورة: {e}")
            err_resp = {"status": "error", "message": str(e)}
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(err_resp).encode("utf-8"))


def main():
    print("=" * 65)
    print("🚦 سيرفر محاكاة الإشارة الذكية التفاعلي للتقاطع الرباعي (+ Shape)")
    print("=" * 65)
    print(f"📂 مجلد الويب: {WEB_DIR}")
    print(f"🌐 الرابط المحلي: http://localhost:{PORT}")
    print("💡 افتح الرابط في المتصفح لتجربة التقاطع وتغيير الصور وفحص أزمنة الإشارات.")
    print("🛑 للإنهاء اضغط على [Ctrl+C].\n")

    server_address = ("", PORT)
    HTTPServer.allow_reuse_address = True
    httpd = HTTPServer(server_address, SimulatorRequestHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🧹 إيقاف السيرفر بنجاح.")
        httpd.server_close()


if __name__ == "__main__":
    main()
