export default function Message({ message }) {
    if (!message) return null;
    return (
        <div className={message.type === 'success' ? 'bg-green-100 text-green-800 p-4 rounded-lg mb-4' : 'bg-red-100 text-red-800 p-4 rounded-lg mb-4'}>
            {message.text}
        </div>
    );
}
