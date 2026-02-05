import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { roomService } from '../services/roomService';
import RoomCard from '../components/FlowerRoom/RoomCard';

const Dashboard = () => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadRooms();
  }, []);

  const loadRooms = async () => {
    try {
      setLoading(true);
      const data = await roomService.getRooms();
      setRooms(data);
    } catch (err) {
      setError('Ошибка загрузки комнат');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRoom = async (id, data) => {
    try {
      const updated = await roomService.updateRoom(id, data);
      setRooms(rooms.map(r => r._id === id ? updated : r));
    } catch (err) {
      console.error('Update error:', err);
    }
  };

  const handleStartCycle = async (id, data) => {
    try {
      const updated = await roomService.startCycle(id, data);
      setRooms(rooms.map(r => r._id === id ? updated : r));
    } catch (err) {
      console.error('Start cycle error:', err);
    }
  };

  const handleHarvest = async (id) => {
    if (!confirm('Вы уверены, что хотите собрать урожай? Данные комнаты будут сброшены.')) {
      return;
    }
    try {
      const updated = await roomService.harvestRoom(id);
      setRooms(rooms.map(r => r._id === id ? updated : r));
    } catch (err) {
      console.error('Harvest error:', err);
    }
  };

  // Calculate stats
  const activeRooms = rooms.filter(r => r.isActive).length;
  const totalPlants = rooms.reduce((sum, r) => sum + (r.plantsCount || 0), 0);
  const avgProgress = activeRooms > 0
    ? Math.round(rooms.filter(r => r.isActive).reduce((sum, r) => sum + (r.progress || 0), 0) / activeRooms)
    : 0;

  const statsCards = [
    {
      title: 'Активных комнат',
      value: `${activeRooms}/5`,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      color: 'primary'
    },
    {
      title: 'Всего кустов',
      value: totalPlants,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      ),
      color: 'green'
    },
    {
      title: 'Средний прогресс',
      value: `${avgProgress}%`,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
      color: 'yellow'
    },
    {
      title: 'Готовы к сбору',
      value: rooms.filter(r => r.isActive && r.progress >= 100).length,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'purple'
    }
  ];

  const colorClasses = {
    primary: 'bg-primary-900/50 text-primary-400',
    green: 'bg-green-900/50 text-green-400',
    yellow: 'bg-yellow-900/50 text-yellow-400',
    purple: 'bg-purple-900/50 text-purple-400'
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div>
      {/* Welcome message */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">
          Добро пожаловать, {user?.name}!
        </h1>
        <p className="text-dark-400 mt-1">Обзор ваших комнат цветения</p>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statsCards.map((card, index) => (
          <div
            key={index}
            className="bg-dark-800 rounded-xl p-4 border border-dark-700"
          >
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${colorClasses[card.color]}`}>
                {card.icon}
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{card.value}</div>
                <div className="text-xs text-dark-400">{card.title}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Flower rooms header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">Комнаты цветения</h2>
        <button
          onClick={loadRooms}
          className="text-dark-400 hover:text-white p-2 hover:bg-dark-800 rounded-lg transition"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Flower rooms grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {rooms.map((room) => (
          <RoomCard
            key={room._id}
            room={room}
            onUpdate={handleUpdateRoom}
            onStartCycle={handleStartCycle}
            onHarvest={handleHarvest}
          />
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
