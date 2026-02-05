import { useParams } from 'react-router-dom';

export default function ArchiveDetail() {
  const { id } = useParams();
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white">Цикл #{id}</h1>
      <p className="text-gray-400 mt-2">Раздел в разработке.</p>
    </div>
  );
}
