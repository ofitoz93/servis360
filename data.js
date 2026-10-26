// Mock veri ve başlangıç durumu
const INITIAL_DATA = {
  company: {
    id: "comp_101",
    name: "TechNova Holding A.Ş.",
    workplace: {
      name: "Merkez Ofis & Fabrika (Maslak Kampüs)",
      lat: 41.1105,
      lng: 29.0225,
      geofenceRadiusMeters: 180 // Otomatik durdurma çemberi (180 metre)
    }
  },
  shuttles: [
    {
      id: "shuttle_1",
      plate: "34 SRV 842",
      model: "Mercedes-Benz Sprinter (2023)",
      capacity: 24,
      driver: {
        id: "drv_1",
        name: "Ahmet Yılmaz",
        phone: "0532 555 12 34",
        shiftStartTime: "07:15", // Yöntem B için otomatik başlama saati
        shiftEndTime: "08:15",
        status: "waiting", // waiting | running | arrived | idle
        battery: 88,
        gpsAccuracy: "3.2m"
      },
      routeId: "route_1",
      assignedEmployeesCount: 18
    },
    {
      id: "shuttle_2",
      plate: "34 LOP 910",
      model: "Volkswagen Crafter (2022)",
      capacity: 19,
      driver: {
        id: "drv_2",
        name: "Mehmet Demir",
        phone: "0544 333 45 67",
        shiftStartTime: "07:30",
        shiftEndTime: "08:25",
        status: "waiting",
        battery: 94,
        gpsAccuracy: "4.1m"
      },
      routeId: "route_2",
      assignedEmployeesCount: 14
    }
  ],
  routes: [
    {
      id: "route_1",
      name: "Kadıköy - Beşiktaş - Maslak Ekspres Rota",
      color: "#3b82f6",
      stops: [
        { id: "s1", name: "Kadıköy Rıhtım Durağı", lat: 40.9904, lng: 29.0255, order: 1, eta: "07:15", passengerCount: 4 },
        { id: "s2", name: "Üsküdar İskele Meydanı", lat: 41.0268, lng: 29.0152, order: 2, eta: "07:30", passengerCount: 5 },
        { id: "s3", name: "Beşiktaş Meydan Durağı", lat: 41.0428, lng: 29.0068, order: 3, eta: "07:45", passengerCount: 6 },
        { id: "s4", name: "Levent Metro Çıkışı", lat: 41.0782, lng: 29.0118, order: 4, eta: "08:00", passengerCount: 3 },
        { id: "s5", name: "Maslak Kampüs (Varış Noktası)", lat: 41.1105, lng: 29.0225, order: 5, eta: "08:15", passengerCount: 0, isDestination: true }
      ],
      // Detaylı yol simülasyon koordinatları (ara adımlar)
      path: [
        [40.9904, 29.0255],
        [41.0050, 29.0200],
        [41.0180, 29.0170],
        [41.0268, 29.0152], // Üsküdar
        [41.0320, 29.0250],
        [41.0450, 29.0330], // 15 Temmuz Köprüsü yaklaşımı
        [41.0460, 29.0220],
        [41.0428, 29.0068], // Beşiktaş
        [41.0550, 29.0080],
        [41.0660, 29.0100],
        [41.0782, 29.0118], // Levent
        [41.0920, 29.0160],
        [41.1020, 29.0190],
        [41.1070, 29.0210],
        [41.1105, 29.0225]  // Maslak Kampüs (Geofence içi)
      ]
    },
    {
      id: "route_2",
      name: "Bakırköy - Mecidiyeköy - Maslak Rota",
      color: "#10b981",
      stops: [
        { id: "s21", name: "Bakırköy İDO Durağı", lat: 40.9780, lng: 28.8720, order: 1, eta: "07:30", passengerCount: 5 },
        { id: "s22", name: "Cevizlibağ Metrobüs", lat: 41.0185, lng: 28.9130, order: 2, eta: "07:45", passengerCount: 4 },
        { id: "s23", name: "Mecidiyeköy Meydan", lat: 41.0665, lng: 28.9935, order: 3, eta: "08:05", passengerCount: 5 },
        { id: "s24", name: "Maslak Kampüs", lat: 41.1105, lng: 29.0225, order: 4, eta: "08:25", passengerCount: 0, isDestination: true }
      ],
      path: [
        [40.9780, 28.8720],
        [41.0000, 28.8900],
        [41.0185, 28.9130],
        [41.0450, 28.9600],
        [41.0665, 28.9935],
        [41.0850, 29.0050],
        [41.1105, 29.0225]
      ]
    }
  ],
  employees: [
    {
      id: "emp_1",
      name: "Canan Yılmaz",
      title: "Kıdemli Yazılım Mühendisi",
      department: "Ar-Ge / Teknoloji",
      assignedShuttleId: "shuttle_1",
      assignedStopId: "s3", // Beşiktaş Meydan Durağı
      status: "waiting", // waiting | boarding | opted_out
      phone: "0533 111 22 33"
    },
    {
      id: "emp_2",
      name: "Burak Kaya",
      title: "Finans Uzmanı",
      department: "Mali İşler",
      assignedShuttleId: "shuttle_1",
      assignedStopId: "s2", // Üsküdar
      status: "waiting",
      phone: "0534 222 33 44"
    },
    {
      id: "emp_3",
      name: "Selin Demir",
      title: "İnsan Kaynakları Uzmanı",
      department: "İK & Bordro",
      assignedShuttleId: "shuttle_2",
      assignedStopId: "s22", // Cevizlibağ
      status: "waiting",
      phone: "0535 333 44 55"
    }
  ]
};
