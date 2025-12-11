from requests.utils import quote

def send_alert_sms(alert_msg: str):
    try:
        message = quote(alert_msg, safe='')

        url = (
            "https://api.msg91.com/api/sendhttp.php?"
            f"authkey={MSG91_AUTHKEY}&"
            f"mobiles={ALERT_PHONE}&"
            f"message={message}&"
            "sender=TESTID&"
            "route=4"
        )

        print("FULL URL:", url)

        r = requests.get(url, timeout=10)
        print("MSG91 RESPONSE:", r.text)

    except Exception as e:
        print("❌ SMS ERROR:", e)

send_alert_sms("Hello EarthPulse SMS test")