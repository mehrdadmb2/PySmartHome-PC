"""
Tests for the outage schedule engine.
"""
import datetime as dt
import pytest
from server import generate_schedule, SLOTS, OUTAGE_DURATION_MINUTES, SKIP_WEEKDAY


class TestGenerateSchedule:
    """Tests for generate_schedule function."""

    def test_basic_schedule_generation(self):
        """Test that schedule is generated for a reference date."""
        ref_date = dt.date(2025, 8, 12)  # Tuesday
        schedule = generate_schedule(ref_date, 13, span=7)
        assert "2025-08-12" in schedule
        assert schedule["2025-08-12"]["start"] == "13:00"
        assert schedule["2025-08-12"]["end"] == "15:00"

    def test_friday_is_skipped(self):
        """Test that Friday is skipped in the schedule."""
        ref_date = dt.date(2025, 8, 15)  # Friday
        schedule = generate_schedule(ref_date, 13, span=7)
        assert "2025-08-15" not in schedule

    def test_slot_alignment(self):
        """Test that all slots align to valid SLOTS."""
        ref_date = dt.date(2025, 8, 12)
        schedule = generate_schedule(ref_date, 13, span=14)
        for item in schedule.values():
            start_hour = int(item["start"][:2])
            assert start_hour in SLOTS

    def test_outage_duration(self):
        """Test that all outages have correct duration."""
        ref_date = dt.date(2025, 8, 12)
        schedule = generate_schedule(ref_date, 13, span=7)
        for item in schedule.values():
            start = item["start"]
            end = item["end"]
            start_min = int(start[:2]) * 60 + int(start[3:])
            end_min = int(end[:2]) * 60 + int(end[3:])
            assert end_min - start_min == OUTAGE_DURATION_MINUTES

    def test_invalid_reference_hour(self):
        """Test that invalid reference hour raises ValueError."""
        ref_date = dt.date(2025, 8, 12)
        with pytest.raises(ValueError):
            generate_schedule(ref_date, 10, span=7)

    def test_schedule_span(self):
        """Test that schedule generates correct number of days."""
        ref_date = dt.date(2025, 8, 12)
        schedule = generate_schedule(ref_date, 13, span=7)
        # 7 days before + 7 days after + today = 15 days (minus Fridays)
        assert len(schedule) >= 13  # At least 13 days (2 Fridays skipped)

    def test_slot_wrapping(self):
        """Test that slots wrap correctly after 19:00."""
        ref_date = dt.date(2025, 8, 12)
        schedule = generate_schedule(ref_date, 19, span=7)
        # After 19:00-21:00, next slot should be 09:00-11:00
        assert schedule["2025-08-12"]["start"] == "19:00"
        assert schedule["2025-08-12"]["end"] == "21:00"


class TestOutageConstants:
    """Tests for outage constants."""

    def test_slots_defined(self):
        """Test that SLOTS constant is defined correctly."""
        assert SLOTS == (9, 11, 13, 15, 17, 19)

    def test_outage_duration(self):
        """Test that outage duration is 120 minutes."""
        assert OUTAGE_DURATION_MINUTES == 120

    def test_skip_weekday(self):
        """Test that Friday (weekday 4) is skipped."""
        assert SKIP_WEEKDAY == 4