import { useState, useEffect } from 'react';

const UserForm = ({ user, roles, onSubmit, onClose }) => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    roles: [],
    isActive: true
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        email: user.email || '',
        password: '',
        name: user.name || '',
        roles: user.roles?.map(r => r._id) || [],
        isActive: user.isActive !== undefined ? user.isActive : true
      });
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleRoleToggle = (roleId) => {
    setFormData(prev => ({
      ...prev,
      roles: prev.roles.includes(roleId)
        ? prev.roles.filter(id => id !== roleId)
        : [...prev.roles, roleId]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const submitData = { ...formData };

      // Don't send empty password when editing
      if (user && !submitData.password) {
        delete submitData.password;
      }

      await onSubmit(submitData);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto border border-dark-700">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">
            {user ? 'Редактировать пользователя' : 'Новый пользователь'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">
              Имя *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
              placeholder="Введите имя"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">
              Email *
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
              placeholder="email@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">
              Пароль {user ? '(оставьте пустым, чтобы не менять)' : '*'}
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required={!user}
              minLength={6}
              className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
              placeholder={user ? 'Новый пароль' : 'Минимум 6 символов'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">
              Роли
            </label>
            <div className="space-y-2">
              {roles.map((role) => (
                <label
                  key={role._id}
                  className="flex items-center space-x-3 p-3 border border-dark-600 rounded-lg hover:bg-dark-700 cursor-pointer transition"
                >
                  <input
                    type="checkbox"
                    checked={formData.roles.includes(role._id)}
                    onChange={() => handleRoleToggle(role._id)}
                    className="w-4 h-4 text-primary-600 bg-dark-700 border-dark-500 rounded focus:ring-primary-500"
                  />
                  <div>
                    <div className="font-medium text-white">{role.name}</div>
                    <div className="text-sm text-dark-400">{role.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleChange}
                className="w-4 h-4 text-primary-600 bg-dark-700 border-dark-500 rounded focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-dark-300">Активный пользователь</span>
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-dark-300 hover:bg-dark-700 rounded-lg transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition disabled:opacity-50"
            >
              {loading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserForm;
