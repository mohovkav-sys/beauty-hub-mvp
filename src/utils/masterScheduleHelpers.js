export const MONTH_NAMES = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];
  
  const RU_SHORT_MONTHS = [
    'янв',
    'фев',
    'мар',
    'апр',
    'май',
    'июн',
    'июл',
    'авг',
    'сен',
    'окт',
    'ноя',
    'дек',
  ];
  
  export const WEEKDAY_LABELS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
  
  export const HOUR_PRESETS = [
    { id: '09-20', label: '09:00–20:00', start: '09:00', end: '20:00' },
    { id: '10-19', label: '10:00–19:00', start: '10:00', end: '19:00' },
    { id: '09-18', label: '09:00–18:00', start: '09:00', end: '18:00' },
    { id: '11-21', label: '11:00–21:00', start: '11:00', end: '21:00' },
  ];
  
  export function formatLocalDateKey(dateInput) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  export function parseDateKeyToLocalDate(dateKey) {
    if (!dateKey || typeof dateKey !== 'string') return null;
    const parts = dateKey.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  
  export function formatRuShortDate(dateKey) {
    const dateObj = parseDateKeyToLocalDate(dateKey);
    if (!dateObj || Number.isNaN(dateObj.getTime())) return dateKey || '';
    const day = dateObj.getDate();
    const monthLabel = RU_SHORT_MONTHS[dateObj.getMonth()] || '';
    return `${day} ${monthLabel}`;
  }
  
  export function normalizeTimeHHMM(rawTime, fallback = '09:00') {
    if (!rawTime || typeof rawTime !== 'string') return fallback;
    const match = rawTime.trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return fallback;
    const hh = String(Math.min(23, Math.max(0, Number(match[1])))).padStart(2, '0');
    const mm = String(Math.min(59, Math.max(0, Number(match[2])))).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  
  export function timeToMinutes(hhmm) {
    const [h, m] = normalizeTimeHHMM(hhmm, '00:00').split(':').map(Number);
    return h * 60 + m;
  }
  
  export function minutesToTime(totalMinutes) {
    const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
    const h = String(Math.floor(clamped / 60)).padStart(2, '0');
    const m = String(clamped % 60).padStart(2, '0');
    return `${h}:${m}`;
  }
  
  export function buildMonthCalendarData(viewMonth, scheduleByDate = {}, bookingsByDate = {}) {
    const todayKey = formatLocalDateKey(new Date());
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingEmptyCount = (firstDayOfMonth.getDay() + 6) % 7;
  
    const cells = [];
    const weeks = [];
    let currentWeekDays = [];
  
    for (let i = 0; i < leadingEmptyCount; i += 1) {
      cells.push({ type: 'empty', key: `empty-start-${i}` });
    }
  
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateObj = new Date(year, month, day);
      const dateKey = formatLocalDateKey(dateObj);
      const dayOfWeek = dateObj.getDay();
      const isCalendarWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const scheduleItem = scheduleByDate[dateKey] || null;
      const dayBookings = bookingsByDate[dateKey] || [];
  
      const hasExplicitSchedule = Boolean(scheduleItem && typeof scheduleItem.is_available === 'boolean');
      const isWorking = hasExplicitSchedule ? Boolean(scheduleItem.is_available) : !isCalendarWeekend;
  
      const cell = {
        type: 'day',
        key: dateKey,
        dateKey,
        dayNumber: day,
        isToday: dateKey === todayKey,
        isCalendarWeekend,
        isWorking,
        hasExplicitSchedule,
        scheduleItem,
        bookingsCount: dayBookings.length,
        weekIndex: weeks.length,
      };
  
      cells.push(cell);
      currentWeekDays.push(cell);
  
      if (dayOfWeek === 0 || day === daysInMonth) {
        weeks.push({
          index: weeks.length,
          label: `Нед. ${weeks.length + 1} (${currentWeekDays[0].dayNumber}–${currentWeekDays[currentWeekDays.length - 1].dayNumber})`,
          dateKeys: currentWeekDays.map((d) => d.dateKey),
        });
        currentWeekDays = [];
      }
    }
  
    const trailingEmptyCount = (7 - (cells.length % 7)) % 7;
    for (let i = 0; i < trailingEmptyCount; i += 1) {
      cells.push({ type: 'empty', key: `empty-end-${i}` });
    }
  
    return { cells, weeks, todayKey };
  }
  
  export function buildDayTimeSlots({
    startTime = '09:00',
    endTime = '20:00',
    isWorkingDay = true,
    dayBookings = [],
    stepMinutes = 30,
    rangeStart = '08:00',
    rangeEnd = '22:00',
  }) {
    const gridStartMin = timeToMinutes(rangeStart);
    const gridEndMin = timeToMinutes(rangeEnd);
    const shiftStartMin = timeToMinutes(startTime);
    const shiftEndMin = timeToMinutes(endTime);
  
    const bookedIntervals = (dayBookings || [])
      .map((booking) => {
        const rawSlot = booking.slot_time || booking.start_time || '';
        const timePart = rawSlot.includes('T')
          ? rawSlot.split('T')[1]?.slice(0, 5)
          : rawSlot.slice(0, 5);
        const startMin = timeToMinutes(timePart || '00:00');
        const duration = Number(
          booking.duration_minutes || booking.services?.duration_minutes || stepMinutes
        );
        return {
          startMin,
          endMin: startMin + Math.max(10, duration),
          title: booking.services?.title || booking.service_title || 'Запись клиента',
        };
      })
      .filter((item) => !Number.isNaN(item.startMin));
  
    const slots = [];
    for (let mins = gridStartMin; mins < gridEndMin; mins += stepMinutes) {
      const slotEndMin = mins + stepMinutes;
      const withinShift = isWorkingDay && mins >= shiftStartMin && slotEndMin <= shiftEndMin;
      const overlappingBooking = bookedIntervals.find(
        (b) => mins < b.endMin && slotEndMin > b.startMin
      );
  
      const isBooked = Boolean(overlappingBooking);
      const disabled = !isWorkingDay || isBooked;
  
      slots.push({
        time: minutesToTime(mins),
        minutes: mins,
        withinShift,
        isBooked,
        bookingTitle: overlappingBooking?.title || null,
        disabled,
      });
    }
  
    return slots;
  }
  
  export function findDayScheduleConflict({ isWorkingDay, startTime, endTime, dayBookings = [] }) {
    if (!dayBookings.length) return null;
  
    if (!isWorkingDay) {
      return {
        type: 'close_with_bookings',
        message: `На этот день уже есть записей: ${dayBookings.length}. Подтвердите перевод в выходной — существующие записи останутся в базе.`,
      };
    }
  
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    if (endMin <= startMin) {
      return {
        type: 'invalid_range',
        message: 'Время окончания смены должно быть позже времени начала.',
      };
    }
  
    const outOfBoundsBooking = dayBookings.find((b) => {
      const rawSlot = b.slot_time || b.start_time || '';
      const timePart = rawSlot.includes('T')
        ? rawSlot.split('T')[1]?.slice(0, 5)
        : rawSlot.slice(0, 5);
      const bookingMin = timeToMinutes(timePart || '00:00');
      const duration = Number(b.duration_minutes || b.services?.duration_minutes || 15);
      return bookingMin < startMin || bookingMin + duration > endMin;
    });
  
    if (outOfBoundsBooking) {
      return {
        type: 'outside_shift',
        message: `Часы смены (${startTime}–${endTime}) перекрывают существующую запись клиента. Расширьте интервал смены.`,
      };
    }
  
    return null;
  }