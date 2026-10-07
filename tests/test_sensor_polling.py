"""
Tests for sensor polling and data normalization.
"""
import pytest
from server import normalize_sensor_payload


class TestNormalizeSensorPayload:
    """Tests for normalize_sensor_payload function."""

    def test_valid_payload(self):
        """Test that valid payload is normalized correctly."""
        payload = {"temp": 28.5, "humidity": 45.0}
        temp, hum = normalize_sensor_payload(payload)
        assert temp == 28.5
        assert hum == 45.0

    def test_alternative_keys(self):
        """Test that alternative keys (temperature, hum) work."""
        payload = {"temperature": 30.0, "hum": 50.0}
        temp, hum = normalize_sensor_payload(payload)
        assert temp == 30.0
        assert hum == 50.0

    def test_invalid_temperature_high(self):
        """Test that temperature above 100 raises ValueError."""
        payload = {"temp": 101.0, "humidity": 45.0}
        with pytest.raises(ValueError):
            normalize_sensor_payload(payload)

    def test_invalid_temperature_low(self):
        """Test that temperature below -40 raises ValueError."""
        payload = {"temp": -41.0, "humidity": 45.0}
        with pytest.raises(ValueError):
            normalize_sensor_payload(payload)

    def test_invalid_humidity_high(self):
        """Test that humidity above 100 raises ValueError."""
        payload = {"temp": 28.5, "humidity": 101.0}
        with pytest.raises(ValueError):
            normalize_sensor_payload(payload)

    def test_invalid_humidity_low(self):
        """Test that humidity below 0 raises ValueError."""
        payload = {"temp": 28.5, "humidity": -1.0}
        with pytest.raises(ValueError):
            normalize_sensor_payload(payload)

    def test_non_dict_payload(self):
        """Test that non-dict payload raises ValueError."""
        with pytest.raises(ValueError):
            normalize_sensor_payload("not a dict")

    def test_missing_keys(self):
        """Test that missing keys raise ValueError."""
        with pytest.raises(ValueError):
            normalize_sensor_payload({})

    def test_rounding(self):
        """Test that values are rounded to 2 decimal places."""
        payload = {"temp": 28.555, "humidity": 45.555}
        temp, hum = normalize_sensor_payload(payload)
        assert temp == 28.56
        assert hum == 45.56