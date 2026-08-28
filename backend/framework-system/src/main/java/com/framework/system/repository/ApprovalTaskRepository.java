package com.framework.system.repository;

import com.framework.system.entity.ApprovalTask;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ApprovalTaskRepository extends JpaRepository<ApprovalTask, Long> {

    List<ApprovalTask> findByInstanceIdOrderBySortAscIdAsc(Long instanceId);

    List<ApprovalTask> findByInstanceIdAndNodeId(Long instanceId, String nodeId);

    List<ApprovalTask> findByInstanceIdAndStatus(Long instanceId, String status);

    List<ApprovalTask> findByInstanceIdAndStatusIn(Long instanceId, List<String> statuses);

    boolean existsByParentTaskId(Long parentTaskId);

    @Query("SELECT COALESCE(MAX(t.sort), 0) FROM ApprovalTask t WHERE t.instanceId = :instanceId")
    int maxSort(@Param("instanceId") Long instanceId);

    /** 待办：任务 PENDING 且实例仍在审批中。 */
    @Query("SELECT t FROM ApprovalTask t, ApprovalInstance i "
            + "WHERE t.instanceId = i.id AND t.assigneeName = :assignee "
            + "AND t.status = 'PENDING' AND i.status = 'PENDING' ORDER BY t.id DESC")
    Page<ApprovalTask> findTodo(@Param("assignee") String assignee, Pageable pageable);

    /** 已办：本人处理过（通过/驳回）的任务。 */
    @Query("SELECT t FROM ApprovalTask t WHERE t.assigneeName = :assignee "
            + "AND t.status IN ('APPROVED', 'REJECTED') ORDER BY t.actedAt DESC")
    Page<ApprovalTask> findDone(@Param("assignee") String assignee, Pageable pageable);

    /** 抄送我的：cc 节点生成的抄送记录（nodeType=cc 且 status=CC），按任务 id 倒序。 */
    @Query("SELECT t FROM ApprovalTask t WHERE t.assigneeName = :assignee "
            + "AND t.nodeType = 'cc' AND t.status = 'CC' ORDER BY t.id DESC")
    Page<ApprovalTask> findCc(@Param("assignee") String assignee, Pageable pageable);
}
