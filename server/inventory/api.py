"""What the other modules may use from inventory (read-only use of the models: the dashboard, the demo seed)."""
from .models import Ingredient, StockRequest, Supplier

__all__ = ['Ingredient', 'StockRequest', 'Supplier']
