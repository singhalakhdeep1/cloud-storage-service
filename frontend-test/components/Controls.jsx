export default function Controls({ filter, setFilter, onRefresh, loading }) {
    return (
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <div className="flex gap-4 items-center justify-between">
                <div className="flex gap-3 items-center">
                    <label className="font-semibold text-gray-700">Filter:</label>
                    <select value={filter} onChange={(e) => setFilter(e.target.value)} className="p-3 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-sky-500 transition-all bg-white cursor-pointer w-36">
                        <option value="all">All Files</option>
                        <option value="image">Images</option>
                        <option value="video">Videos</option>
                        <option value="document">Documents</option>
                        <option value="audio">Audio</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <button onClick={onRefresh} className="bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold transition-all disabled:opacity-60" disabled={loading}>
                    {loading ? 'Loading...' : '🔄 Refresh'}
                </button>
            </div>
        </div>
    );
}
