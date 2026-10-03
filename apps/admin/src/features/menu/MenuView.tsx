import React, { useEffect, useState } from 'react';
import {
  Plus,
  Edit2,
  CheckCircle2,
  XCircle,
  ShoppingBag,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Switch } from '@/components/common/Switch';
import { Modal } from '@/components/common/Modal';
import { FilterBar } from '@/components/common/FilterBar';
import { EmptyState } from '@/components/common/EmptyState';
import { menuService } from '@/services/menuService';
import { MenuItem, MenuItemCategory } from '@/types/viewModels';

export const MenuView: React.FC = () => {
  const [categories, setCategories] = useState<MenuItemCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStockFilter, setSelectedStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [cats, menuItems] = await Promise.all([
        menuService.getCategories(),
        menuService.getMenuItems(),
      ]);
      setCategories(cats);
      setItems(menuItems);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleStock = async (itemId: string, currentVal: boolean) => {
    const updated = await menuService.toggleAvailability(itemId, !currentVal);
    setItems((prev) => prev.map((item) => (item.id === itemId ? updated : item)));
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    const updated = await menuService.updateItem(editingItem);
    setItems((prev) => {
      const index = prev.findIndex((i) => i.id === updated.id);
      if (index === -1) return [updated, ...prev];
      return prev.map((i) => (i.id === updated.id ? updated : i));
    });
    setIsModalOpen(false);
    setEditingItem(null);
  };

  const handleOpenNewModal = () => {
    setEditingItem({
      id: `item-${Date.now()}`,
      categoryId: categories[0]?.id || 'cat-1',
      name: '',
      description: '',
      price: 0,
      isAvailable: true,
      imageUrl: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setIsModalOpen(true);
  };

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (selectedCategoryId !== 'all' && item.categoryId !== selectedCategoryId) return false;
    if (selectedStockFilter === 'in_stock' && !item.isAvailable) return false;
    if (selectedStockFilter === 'out_of_stock' && item.isAvailable) return false;

    return true;
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Category Pills & Actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedCategoryId('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              selectedCategoryId === 'all'
                ? 'bg-orange-600 text-white shadow-xs'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Todas las Categorías ({items.length})
          </button>
          {categories.map((cat) => {
            const count = items.filter((i) => i.categoryId === cat.id).length;
            const isSelected = selectedCategoryId === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-orange-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {cat.name} ({count})
              </button>
            );
          })}
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={handleOpenNewModal}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Nuevo Producto
        </Button>
      </div>

      {/* Filter Bar */}
      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Buscar plato por nombre o ingrediente..."
        filters={[
          { id: 'all', label: 'Todos', active: selectedStockFilter === 'all', onClick: () => setSelectedStockFilter('all') },
          { id: 'in_stock', label: 'Disponibles', active: selectedStockFilter === 'in_stock', count: items.filter((i) => i.isAvailable).length, onClick: () => setSelectedStockFilter('in_stock') },
          { id: 'out_of_stock', label: 'Agotados', active: selectedStockFilter === 'out_of_stock', count: items.filter((i) => !i.isAvailable).length, onClick: () => setSelectedStockFilter('out_of_stock') },
        ]}
      />

      {/* Products Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="w-8 h-8 text-slate-400" />}
          title="No hay productos en esta vista"
          description="Intente con otro término de búsqueda o seleccione otra categoría."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategoryId('all');
                setSelectedStockFilter('all');
              }}
            >
              Ver todo el menú
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`bg-white rounded-2xl border transition-all duration-200 shadow-2xs hover:shadow-md overflow-hidden flex flex-col justify-between ${
                item.isAvailable ? 'border-slate-200' : 'border-rose-200 bg-rose-50/20'
              }`}
            >
              {/* Product Image & Stock Badge */}
              <div className="relative h-44 bg-slate-100 overflow-hidden">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className={`w-full h-full object-cover transition-transform duration-300 hover:scale-105 ${
                      !item.isAvailable ? 'grayscale opacity-75' : ''
                    }`}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                    Sin foto
                  </div>
                )}

                {/* Instant Stock Badge overlay */}
                <div className="absolute top-3 left-3">
                  {item.isAvailable ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-white/95 text-emerald-700 shadow-sm backdrop-blur-xs">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Disponible
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-600 text-white shadow-sm">
                      <XCircle className="w-3.5 h-3.5 text-white" />
                      Agotado
                    </span>
                  )}
                </div>

                <div className="absolute top-3 right-3">
                  <span className="px-2.5 py-1 rounded-lg text-sm font-black bg-slate-900/80 text-white backdrop-blur-xs shadow-sm">
                    ${item.price.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Product Info */}
              <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <h4 className="font-bold text-slate-900 text-base">{item.name}</h4>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                {/* Instant Toggle Control */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={item.isAvailable}
                      onChange={() => handleToggleStock(item.id, item.isAvailable)}
                      size="sm"
                    />
                    <span className="text-xs font-semibold text-slate-700">
                      {item.isAvailable ? 'En stock' : 'Pausar stock'}
                    </span>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingItem({ ...item });
                      setIsModalOpen(true);
                    }}
                    leftIcon={<Edit2 className="w-3.5 h-3.5 text-slate-500" />}
                  >
                    Editar
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT PRODUCT MODAL */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingItem?.name ? `Editar "${editingItem.name}"` : 'Crear Nuevo Plato en Menú'}
        maxWidth="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveItem}>
              Guardar Cambios
            </Button>
          </div>
        }
      >
        {editingItem && (
          <form onSubmit={handleSaveItem} className="space-y-4 text-xs sm:text-sm">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nombre del Plato:</label>
              <input
                type="text"
                value={editingItem.name}
                onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                placeholder="ej. Burger Trufada Deluxe"
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Categoría:</label>
                <select
                  value={editingItem.categoryId}
                  onChange={(e) => setEditingItem({ ...editingItem, categoryId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Precio ($ USD):</label>
                <input
                  type="number"
                  step="0.10"
                  min="0"
                  value={editingItem.price}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, price: parseFloat(e.target.value) || 0 })
                  }
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Descripción para WhatsApp (La IA usará este texto):
              </label>
              <textarea
                rows={3}
                value={editingItem.description}
                onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                placeholder="Describe los ingredientes, sabores y guarniciones..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">URL de Imagen del Plato:</label>
              <input
                type="url"
                value={editingItem.imageUrl || ''}
                onChange={(e) => setEditingItem({ ...editingItem, imageUrl: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <Switch
                checked={editingItem.isAvailable}
                onChange={(checked) => setEditingItem({ ...editingItem, isAvailable: checked })}
                label="Disponible para ordenar inmediatamente"
                description="Si se desmarca, la IA avisará que está agotado y sugerirá sustitutos."
              />
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
