package com.framework.system.controller;

import com.framework.common.result.PageResult;
import com.framework.common.result.Result;
import com.framework.system.entity.Notification;
import com.framework.system.repository.NotificationRepository;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 通知中心：按接收人查询、未读数、标记已读。
 */
@RestController
@RequestMapping("/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationRepository notificationRepository;

    @GetMapping
    public Result<PageResult<Notification>> page(@RequestParam(name = "userName") String userName,
                                                 @RequestParam(name = "unreadOnly", required = false) Boolean unreadOnly,
                                                 @RequestParam(name = "type", required = false) String type,
                                                 @RequestParam(name = "page", defaultValue = "1") int page,
                                                 @RequestParam(name = "size", defaultValue = "10") int size) {
        Specification<Notification> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(cb.equal(root.get("userName"), userName));
            if (Boolean.TRUE.equals(unreadOnly)) {
                predicates.add(cb.isFalse(root.get("read")));
            }
            if (type != null && !type.isBlank()) {
                predicates.add(cb.equal(root.get("type"), type));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
        Page<Notification> data = notificationRepository.findAll(spec,
                PageRequest.of(Math.max(page - 1, 0), size, Sort.by(Sort.Direction.DESC, "id")));
        return Result.ok(PageResult.of(data.getContent(), data.getTotalElements(), page, size));
    }

    @GetMapping("/unread-count")
    public Result<Map<String, Object>> unreadCount(@RequestParam(name = "userName") String userName) {
        Map<String, Object> result = new HashMap<>();
        result.put("count", notificationRepository.countByUserNameAndReadFalse(userName));
        return Result.ok(result);
    }

    @PostMapping("/{id}/read")
    public Result<Notification> read(@PathVariable("id") Long id) {
        return notificationRepository.findById(id).map(notification -> {
            notification.setRead(true);
            return Result.ok(notificationRepository.save(notification));
        }).orElse(Result.fail(404, "通知不存在"));
    }

    @PostMapping("/read-all")
    @Transactional
    public Result<Map<String, Object>> readAll(@RequestParam(name = "userName") String userName) {
        int updated = notificationRepository.markAllRead(userName);
        Map<String, Object> result = new HashMap<>();
        result.put("markedRead", updated);
        return Result.ok(result);
    }
}
