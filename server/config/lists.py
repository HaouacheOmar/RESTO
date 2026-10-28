from rest_framework.pagination import LimitOffsetPagination


class HistoryPagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 200


class ScopedListMixin:
    """Lists that grow every day never come back whole.

    `?scope=active`: the current items (pending, confirmed, delivering…), bounded by real activity, not paginated.
    `?scope=history`: the finished ones, newest first, paginated (`limit`/`offset`).
    No scope: everything, paginated. A viewset lists in `bounded_params` the filters that already bound the list
    (e.g. `?date=` for one day of Additions); with one of them the list is not paginated either.
    """
    pagination_class = HistoryPagination
    history_ordering = ('-pk',)
    bounded_params = ()

    def active_filter(self):
        """Q object selecting the current items."""
        raise NotImplementedError

    @property
    def scope(self):
        return self.request.query_params.get('scope') if self.action == 'list' else None

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        if self.scope == 'active':
            return queryset.filter(self.active_filter())
        if self.scope == 'history':
            return queryset.exclude(self.active_filter()).order_by(*self.history_ordering)
        return queryset

    def paginate_queryset(self, queryset):
        params = self.request.query_params
        if self.scope == 'active' or any(params.get(p) for p in self.bounded_params):
            return None
        return super().paginate_queryset(queryset)
