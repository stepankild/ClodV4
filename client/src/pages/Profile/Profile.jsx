import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { authService } from '../../services/authService';

/** Resize image to square via canvas */
function resizeImage(file, maxSize = 200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const Profile = () => {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const fileInputRef = useRef(null);

  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setSuccess('');
    try {
      const base64 = await resizeImage(file, 200);
      setPreview(base64);
    } catch {
      setError(t('profile.avatarError'));
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setSaving(true);
    setError('');
    try {
      const result = await authService.uploadAvatar(preview);
      const updatedUser = { ...user, avatar: result.avatar };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setPreview(null);
      setSuccess(t('profile.avatarUpdated'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || t('profile.avatarError'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    setError('');
    try {
      await authService.deleteAvatar();
      const updatedUser = { ...user, avatar: null };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setPreview(null);
      setSuccess(t('profile.avatarRemoved'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || t('profile.avatarError'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setPreview(null);
    setError('');
  };

  const displayAvatar = preview || user?.avatar;

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t('profile.title')}</h1>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4 flex items-center gap-3">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-300 hover:text-white text-lg leading-none">&times;</button>
        </div>
      )}

      {success && (
        <div className="bg-green-900/30 border border-green-800 text-green-400 px-4 py-3 rounded-lg mb-4">
          {success}
        </div>
      )}

      <div className="bg-dark-800 rounded-xl border border-dark-700 p-6">
        {/* Avatar section */}
        <div className="flex flex-col items-center mb-6">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative group mb-3"
          >
            {displayAvatar ? (
              <img
                src={displayAvatar}
                alt=""
                className="w-28 h-28 rounded-full object-cover border-2 border-dark-600 group-hover:border-primary-500 transition"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-primary-900/50 flex items-center justify-center border-2 border-dark-600 group-hover:border-primary-500 transition">
                <span className="text-4xl font-bold text-primary-400">
                  {user?.name?.charAt(0)?.toUpperCase()}
                </span>
              </div>
            )}
            <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          <p className="text-dark-500 text-xs">{t('profile.clickToChange')}</p>

          {/* Avatar action buttons */}
          {preview ? (
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg text-sm"
              >
                {t('profile.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-500 text-sm font-medium disabled:opacity-50"
              >
                {saving ? '...' : t('profile.save')}
              </button>
            </div>
          ) : user?.avatar ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={saving}
              className="mt-3 px-3 py-1 text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
            >
              {t('profile.removeAvatar')}
            </button>
          ) : null}
        </div>

        {/* User info */}
        <div className="space-y-4 border-t border-dark-700 pt-5">
          <h2 className="text-sm font-semibold text-white">{t('profile.personalInfo')}</h2>

          <div>
            <label className="block text-xs text-dark-500 mb-1">{t('profile.name')}</label>
            <div className="px-3 py-2 bg-dark-900 border border-dark-700 rounded-lg text-white text-sm">
              {user?.name || '—'}
            </div>
          </div>

          <div>
            <label className="block text-xs text-dark-500 mb-1">{t('profile.email')}</label>
            <div className="px-3 py-2 bg-dark-900 border border-dark-700 rounded-lg text-white text-sm">
              {user?.email || '—'}
            </div>
          </div>

          {user?.roles?.length > 0 && (
            <div>
              <label className="block text-xs text-dark-500 mb-1">{t('profile.roles')}</label>
              <div className="flex flex-wrap gap-2">
                {user.roles.map(r => (
                  <span key={r.id} className="px-2.5 py-1 bg-primary-900/40 text-primary-400 rounded-lg text-xs font-medium">
                    {r.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Profile;
